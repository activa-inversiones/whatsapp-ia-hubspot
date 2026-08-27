// services/informeTermicoPdf.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// EL INFORME TÉRMICO, EN PDF FIRMADO.
//
// El dueño lo pidió así, textual: *"esperaba un archivo de PDF más formal"*. Tenía razón
// y la primera versión (un mensaje de WhatsApp) era la decisión equivocada para este caso:
// un mensaje se pierde en el scroll, un PDF firmado se GUARDA y se REENVÍA — al marido, al
// arquitecto, al maestro. Y ese reenvío es exactamente lo que se busca.
//
// MISMA IDENTIDAD VISUAL que la propuesta (index.js generateLocalQuotePdf): navy + dorado,
// para que el cliente reciba dos documentos que se ven de la misma casa.
//
// ⚠️ NO ES LA COTIZACIÓN. Va ANTES, no lleva precios, y lo dice explícitamente. Es un
// informe de la NORMA que aplica en su comuna — la propuesta llega después.
//
// ⚠️ LECCIÓN APLICADA (2026-08-20): la paginación automática de pdfkit metía 3 páginas en
// blanco en TODAS las cotizaciones, porque la función posiciona con coordenadas absolutas y
// cualquier `y` bajo el margen inferior se leía como desborde. Acá se apaga desde el
// principio y los saltos son explícitos. No repetir ese bug.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.1.0';

/**
 * El pie de cada lámina, EN CASTELLANO DE CLIENTE. THERMAL trae una descripción técnica
 * ("Corte vertical: isotermas cada 1 grado C y elementos que ve el solver") que le sirve a
 * un ingeniero y no le dice nada a quien está comprando ventanas. Acá se explica QUÉ MIRAR
 * y POR QUÉ IMPORTA — sin agregar ni un dato que la figura no respalde.
 */
const PIES_LAMINA = Object.freeze({
  // ── LOS NUDOS CON PANEL: lo que el dueño pidió ver ───────────────────────────────────
  // [2026-08-24] Textual: *"sería mejor presentarlos por separador superior e inferior con
  // panel, mejor para que se vean las isotermas, porque a esta le falta todo"*, sobre los
  // cortes completos (01 y 02). Tenía razón en el uso que les estábamos dando: un corte
  // entero a escala chica no deja ver el borde, que es justo donde pasa lo que importa.
  // Los nudos 03/04 son los que traen el termopanel extendido 190 mm —la sustitución por
  // panel que exige la norma— y ahí las isotermas del borde se leen de verdad.
  '04': 'Nudo SUPERIOR: el encuentro entre el marco de arriba y el termopanel, con el panel extendido '
      + '190 mm como exige el método normativo. Cada línea une los puntos que están a la misma '
      + 'temperatura. Mientras las líneas se mantengan separadas y lejos de la cara interior, el calor '
      + 'no está encontrando un camino fácil para salir.',
  '03': 'Nudo INFERIOR, el mismo encuentro abajo. Es el punto más exigido de la ventana: el aire frío se '
      + 'acumula en la parte baja del vidrio y por eso, si algo se va a empañar, empieza por ahí. Acá se '
      + 've cuánto alcanza a subir el frío desde el borde.',
  // [2026-08-24] PRECISIÓN DEL DUEÑO: los 160 W/m·K son del SEPARADOR de aluminio —el
  // marco metálico que va DENTRO del termopanel, entre los dos vidrios—, no del perfil de
  // la ventana. Escrito como estaba, un cliente podía leer que hablábamos de una ventana de
  // aluminio. Se desambigua nombrando la pieza, y se deja el paralelo con el perfil de
  // aluminio: es el MISMO metal y por eso arrastra el mismo problema — un argumento
  // legítimo y verificable, sin inventarle un Uf a un producto que no cotizamos.
  '07': 'Nudo inferior de la ventana —la zona más exigida del conjunto, por la acumulación de aire frío '
      + 'en la parte baja del vidrio— resuelto con SEPARADOR DE ALUMINIO: el marco metálico que va dentro '
      + 'del termopanel, entre los dos vidrios, separándolos. Ese aluminio conduce 160 W/m·K frente a los '
      + '0,135 W/m·K del separador warm-edge, y se observa cómo las isotermas frías ascienden junto al '
      + 'canto del vidrio. Es el mismo metal del que están hechos los perfiles de ventana de aluminio, y '
      + 'por la misma razón: donde hay metal continuo entre el interior y el exterior, el calor encuentra '
      + 'un camino directo para salir. Constituye el caso desfavorable, y es la solución que incorpora la '
      + 'mayoría de los termopaneles del mercado.',
  '08': 'El mismo nudo resuelto con separador warm-edge. En la comparación con la figura anterior se '
      + 'aprecia el retroceso de las isotermas frías respecto del canto del vidrio: un borde interior más '
      + 'templado reduce el riesgo de condensación en esa zona.',
  '01': 'Corte vertical del marco y el termopanel. El rojo es el lado de adentro (calefaccionado) y el '
      + 'azul el de afuera. Las cámaras de aire del PVC son las que frenan el paso del frío: por eso la '
      + 'transición es gradual y no hay un salto brusco hacia el interior.',
  '02': 'El mismo corte, visto en horizontal. Sirve para ver el encuentro entre la hoja y el marco, que '
      + 'es donde una ventana mal resuelta pierde más calor.',
  // [P1 · Gemini] Se corrigieron DOS cosas de este pie, y las dos importan porque el
  // documento va firmado por un evaluador acreditado:
  //   · "el aluminio conduce el frío" es físicamente incorrecto — lo que pasa es que deja
  //     ESCAPAR el calor. En un informe técnico esa frase sola le baja la credibilidad.
  //   · "es la diferencia entre un termopanel que amanece empañado y uno que no" es una
  //     promesa ABSOLUTA. La condensación depende también de la humedad interior y de la
  //     ventilación de la casa: con una estufa a gas y sin ventilar, condensa igual.
  //     Prometerlo en un documento firmado es regalarle al cliente el respaldo para un
  //     reclamo de garantía. Se mantiene la fuerza comercial, se saca la garantía implícita.
  //   · Tercera pasada [P1 · Codex]: seguia AFIRMANDO un resultado de condensacion, y una
  //     figura ilustrativa no puede respaldar eso.
  //   · 🔴 CUARTA Y DEFINITIVA [2026-08-24], y esta no la pidio un revisor sino EL PROPIO
  //     MOTOR DE ACTIVA. La lamina del termopanel que genera THERMAL
  //     (tools/lamina_termopanel_separadores.py) reporta, para Temuco a 65 % de HR interior:
  //           borde ALUMINIO   θsi =  9,2 °C  -> CONDENSA
  //           borde WARM-EDGE θsi = 11,8 °C  -> CONDENSA
  //           centro de vidrio θsi = 13,3 °C  -> no condensa
  //     y el umbral que devuelve la API para Temuco es 12,28 °C a 65 % (14,47 °C a 75 %).
  //     O sea: EN TEMUCO EL BORDE CONDENSA CON LOS DOS SEPARADORES. El warm-edge cierra casi
  //     toda la brecha (9,2 → 11,8) pero NO la cruza. Cualquier texto que insinue que con
  //     warm-edge "no se empaña" contradice al motor de la propia empresa, en un documento
  //     que ella misma firma. Eso no es una imprecision de redaccion: es entregarle al
  //     cliente el papel con el que reclamar.
  //     ⛔ Y NO se transcriben esos numeros al PDF: salen de LEER UNA FIGURA, que es
  //     exactamente lo que el contrato con THERMAL prohibe. El dato declarable es el umbral
  //     calculado, que ya vive en la seccion de condensacion de este mismo informe.
  '10': 'ESTA es la que conviene mirar dos veces: el mismo perfil con separador de ALUMINIO (izquierda) y '
      + 'con separador WARM-EDGE (derecha). El aluminio actúa como puente térmico y deja escapar el calor '
      + 'por el borde del vidrio: por eso se ve la franja fría pegada al canto, mucho más marcada que con '
      + 'el warm-edge. El warm-edge sube bastante la temperatura de ese borde, y esa diferencia es real y '
      + 'medible. Ahora, siendo francos: en las mañanas más frías el BORDE del termopanel puede alcanzar '
      + 'igual la temperatura de condensación, con uno u otro separador — el centro del vidrio es el que '
      + 'se mantiene seco. La temperatura exacta a la que eso ocurre en su comuna está calculada en la '
      + 'sección de condensación de este informe.',
});

/** Tope de megapíxeles por figura. Ver el comentario largo en `laminasThermal.js`. */
const MAX_MPX_FIGURA = Number(process.env.THERMAL_LAMINA_MAX_MPX || 8);

/** Ancho y alto de un PNG leyendo su cabecera IHDR. null si no es un PNG. */
function medirPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null;
  const ancho = buf.readUInt32BE(16);
  const alto = buf.readUInt32BE(20);
  return ancho > 0 && alto > 0 ? { ancho, alto } : null;
}

const NAVY = '#0B3D6F';
const GOLD = '#C4993B';
const GRAY = '#485A6B';   // [2026-08-24] antes #6B7B8D: ~4:1 sobre blanco, ilegible en el telefono
const DARK = '#1A2332';

const dec = (n, d = 1) => Number(n).toFixed(d).replace('.', ',');
// 🔴 [2026-08-24] `Number(null) === 0`, Y ESE CERO SE DIBUJA. El dueño lo cazó mirando un
// informe: decía «Uw calculado 0,00 W/m²K · CUMPLE». Un documento firmado por un Evaluador
// Energético acreditado MINVU declarando que una ventana cumple con transmitancia CERO.
//
// Y no era el único camino. En toda comuna SIN Plan de Descontaminación la API devuelve
// `uw_max_Wm2K: null` porque ahí la norma NO pone tope por elemento (Vilcún, verificado
// 24-ago). Ese null se volvía 0 y el informe acusaba «exigencia 0,00 W/m²K · NO CUMPLE»:
// le decíamos a un cliente que su ventana incumple, contra un tope que no existe.
//
// La raíz es tratar AUSENCIA DE DATO y VALOR CERO como la misma cosa. No lo son, y en un
// informe firmado la diferencia es la que separa «no lo declaro» de «declaro un cero».
// `Number('')` también da 0, así que la cadena vacía entra en la misma regla.
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Piso físico del Uw de una ventana. El mejor triple vidriado del mercado ronda 0,6-0,8
// W/m²K; nada real baja de ~0,5. Un valor bajo ese piso no es una ventana excepcional: es
// un dato corrupto. En un informe firmado eso se CALLA, no se declara — porque un Uw
// absurdamente bajo siempre «CUMPLE», y un falso CUMPLE es el error caro.
const UW_MIN_PLAUSIBLE = 0.5;

/**
 * QUE SE LE DECLARA AL CLIENTE SOBRE SU Uw. Funcion PURA y exportada a proposito.
 *
 * Vivia como tres expresiones sueltas dentro del codigo de dibujo, y ahi no habia forma
 * honesta de probarla: pdfkit escribe el texto como glifos hex de una fuente embebida, asi
 * que verificar el veredicto exigia parsear el PDF. Una decision que puede firmar un
 * "CUMPLE" falso en un documento MINVU no puede ser intestable.
 *
 * Tres estados, y ninguno se confunde con otro:
 *   · uwCliente  null = no lo sabemos (o el dato es imposible) => NO se declara
 *   · exigencia  null = la comuna no fija tope por elemento    => NO hay que cumplir nada
 *   · cumple     null = no hay veredicto posible               => NO se dictamina
 *
 * @param {*} suUw        Uw calculado de la ventana del cliente
 * @param {*} uwMaxNorma  tope de la comuna (null donde no rige un PDA)
 */
export function veredictoUw(suUw, uwMaxNorma) {
  const bruto = num(suUw);
  const uwCliente = bruto !== null && bruto >= UW_MIN_PLAUSIBLE ? bruto : null;
  const exigencia = num(uwMaxNorma);
  const cumple = uwCliente !== null && exigencia !== null ? uwCliente <= exigencia : null;
  return { uwCliente, exigencia, cumple };
}

/**
 * EL PROYECTO COMPLETO, VENTANA POR VENTANA. Función PURA y exportada.
 *
 * PEDIDO DEL DUEÑO (2026-08-24, textual): *"no podemos cotizarle una ventana al cliente
 * teniendo ocho ventanas con transmitancias térmicas [distintas]"*. Hasta hoy el informe
 * declaraba el Uw de `items[0]` bajo el rótulo "LA VENTANA DE SU COTIZACIÓN", en singular,
 * y las otras siete no existían para el documento.
 *
 * Y el cálculo YA ESTABA HECHO: `enginePricer.js:491` guarda `item.termico` en CADA ítem,
 * o sea las seis ventanas de un proyecto ya tienen su Uw calculado contra ACTIVA THERMAL
 * con sus medidas, su perfil y su vidrio EFECTIVOS. Se estaba tirando a la basura.
 *
 * 🔴 LAS FILAS SIN Uw NO SE OMITEN. Medido en la BD viva el 24-ago: 130 de 630 cotizaciones
 * (20,6 %) salen con `termico: null`, y no por azar — toda corredera de 4 m² o más usa hoja
 * H98, que la API térmica todavía no tiene cargada (`quoteEngine.js:1007` +
 * `uwClient.js` SLIDING_PERFIL_POR_HOJA), y `PERFIL_MAP` no tiene ninguna puerta. Omitir
 * esas filas haría parecer que el proyecto tiene MENOS ventanas de las que tiene, que es
 * peor que decir la verdad: la ventana se lista y se rotula "perfil en certificación".
 * Redacción aprobada por el dueño.
 *
 * @param {Array} ventanas    ítems: {id, producto, medidas, vidrio, ambiente, cantidad, uw}
 * @param {*}     uwMaxNorma  tope de la comuna (null donde no rige un PDA)
 */
export function resumenVentanas(ventanas, uwMaxNorma) {
  const lista = Array.isArray(ventanas) ? ventanas : [];
  const exigencia = num(uwMaxNorma);

  const filas = lista.map((v, i) => {
    const { uwCliente, cumple } = veredictoUw(v && v.uw, uwMaxNorma);
    // 🔴 [2026-08-24 · Codex] LA CANTIDAD NO SE INVENTA. Antes esto era `Number(qty) || 1`
    // y convertia `undefined`, `0`, `'abc'` y los negativos en un 1 que nadie informo.
    // Que la fila exista prueba que hay AL MENOS una ventana —de ahi salio el item
    // cotizado— asi que 1 se mantiene como PISO para que los conteos cierren; lo que
    // faltaba era distinguirlo de un dato informado. Un supuesto que no se puede
    // distinguir de un hecho es, a efectos del documento firmado, una invencion.
    const nCant = Number(v?.cantidad);
    const cantidadCierta = Number.isInteger(nCant) && nCant > 0;
    const cantidad = cantidadCierta ? nCant : 1;
    return {
      id: String(v?.id || `V${i + 1}`),
      producto: String(v?.producto || 'Ventana').trim(),
      medidas: String(v?.medidas || '').trim(),
      vidrio: String(v?.vidrio || '').trim(),
      ambiente: String(v?.ambiente || '').trim(),
      cantidad,
      cantidadIncierta: !cantidadCierta,
      uw: uwCliente,
      cumple,
      // Lo que se imprime cuando no hay Uw. No es un dato que falte del cliente: es un
      // perfil que todavía no está certificado de nuestro lado, y así se dice.
      motivo: uwCliente === null ? 'perfil en certificación' : '',
    };
  });

  const conUw = filas.filter((f) => f.uw !== null);
  const vidrios = [...new Set(filas.map((f) => f.vidrio).filter(Boolean))];
  // 🔴 [2026-08-24 · Codex] TODO LO QUE SE DECLARA SE CUENTA EN UNIDADES. El encabezado
  // sumaba cantidades y la sintesis contaba filas: dos partidas de 3 daban "6 ventanas"
  // arriba y "Las 2 ventanas calculadas cumplen" abajo, en la misma pagina firmada. El
  // cliente compra unidades; las filas son un detalle de como se agrupo la cotizacion.
  const unidades = (lista) => lista.reduce((n, f) => n + f.cantidad, 0);

  return {
    filas,
    exigencia,
    vidrios,                                   // termopaneles distintos presentes en el proyecto
    totalVentanas: unidades(filas),
    conUw: conUw.length,                       // FILAS con Uw (detalle de la cotizacion)
    sinUw: filas.length - conUw.length,        // FILAS sin Uw
    unidadesConUw: unidades(conUw),            // lo que se le declara al cliente
    unidadesSinUw: unidades(filas.filter((f) => f.uw === null)),
    // `null` = no hay veredicto de conjunto posible (o no hay tope, o falta algún Uw).
    // JAMÁS se afirma "todo el proyecto cumple" si alguna ventana no se pudo calcular:
    // sería extender un veredicto a algo que no se midió, en un documento firmado.
    todasCumplen: exigencia !== null && filas.length > 0 && conUw.length === filas.length
      ? filas.every((f) => f.cumple === true)
      : null,
    peorUw: conUw.length ? Math.max(...conUw.map((f) => f.uw)) : null,
    mejorUw: conUw.length ? Math.min(...conUw.map((f) => f.uw)) : null,
  };
}

/**
 * LA SINTESIS DEL CONJUNTO: las dos o tres frases en negrita bajo la tabla, que es lo unico
 * que un cliente apurado lee de todo el informe. Devuelve `[{ texto, tono, size }]`.
 *
 * 🔴 [2026-08-24] Es una funcion PURA a proposito. Antes vivia embebida en el dibujo del
 * PDF —o sea no se podia probar— y ahi tenia un defecto que solo se ve enumerando casos:
 * la rama de incumplimiento cerraba SIEMPRE con "El resto cumple", incluso cuando las 8
 * ventanas del proyecto excedian la exigencia y no habia ningun resto. Una afirmacion de
 * cumplimiento sobre un conjunto vacio, en un documento firmado por un evaluador
 * acreditado MINVU. La regla del proyecto es no inventar datos; afirmar de mas sobre un
 * conjunto vacio es la misma falta con otra cara.
 *
 * Regla que ordena todo lo de abajo: solo se afirma lo que se midio. Si falta un Uw no hay
 * veredicto de conjunto, y si no hay exigencia no hay nada contra que comparar.
 */
export function sintesisProyecto(proyecto) {
  const p = proyecto || {};
  const filas = Array.isArray(p.filas) ? p.filas : [];
  if (!filas.length) return [];
  const lineas = [];
  // UNIDADES, no filas: es lo que el cliente compra y lo que dice el encabezado.
  const n = Number(p.totalVentanas) || filas.length;
  const pendientes = Number.isFinite(Number(p.unidadesSinUw)) ? Number(p.unidadesSinUw) : 0;

  if (p.todasCumplen === true) {
    // Concordancia: con una sola ventana decia "Las 1 ventanas calculadas cumplen".
    lineas.push({ texto: n === 1
      ? 'La ventana calculada cumple la exigencia de su comuna.'
      : `Las ${n} ventanas calculadas cumplen la exigencia de su comuna.`,
    tono: 'ok', size: 9 });
  } else if (p.todasCumplen === false) {
    const malas = filas.filter((f) => f.cumple === false);
    const unidadesMalas = malas.reduce((k, f) => k + f.cantidad, 0);
    // "El resto cumple" SOLO si existe un resto. Y "No cumplen" en vez de "Sobre la
    // exigencia": en Chile "sobre la exigencia" se puede leer como "respecto a la
    // exigencia", que deja al cliente sin saber si su ventana pasa o no. La frase que
    // cierra un informe firmado tiene que ser categorica.
    const ids = malas.map((f) => f.id).join(', ');
    lineas.push(unidadesMalas === n
      ? { texto: n === 1
        ? 'La ventana calculada no cumple la exigencia de su comuna.'
        : `Ninguna de las ${n} ventanas calculadas cumple la exigencia de su comuna.`,
      tono: 'alerta', size: 9 }
      // [Gemini · 3a pasada] "No cumplen ... V1" con UNA sola fallada es discordante.
      : { texto: unidadesMalas === 1
        ? `No cumple la exigencia de su comuna: ${ids}. El resto cumple.`
        : `No cumplen la exigencia de su comuna: ${ids}. El resto cumple.`,
      tono: 'alerta', size: 9 });
  }

  if (pendientes > 0) {
    // Concordancia de numero: "1 de 3 ventanas QUEDA" / "2 de 3 ventanas QUEDAN", y el
    // cierre en singular referido AL CALCULO, no a las ventanas (P2 de Gemini: decia
    // "se las informamos apenas esté disponible", mezclando plural con singular).
    const queda = pendientes === 1 ? 'queda' : 'quedan';
    lineas.push({
      texto: `${pendientes} de ${n} ventanas ${queda} con el cálculo pendiente: su perfil está en `
        + 'proceso de certificación en nuestro laboratorio de cálculo. Se lo informamos apenas '
        + 'esté disponible, sin costo.',
      tono: 'neutro', size: 8,
    });
  }

  if (Array.isArray(p.vidrios) && p.vidrios.length > 1) {
    // "A y B y C" es polisindeton: no se escribe asi en un informe tecnico. Con dos va la
    // "y" a secas; con tres o mas, comas y "y" solo antes del ultimo.
    const lista = p.vidrios.length === 2
      ? p.vidrios.join(' y ')
      : `${p.vidrios.slice(0, -1).join(', ')} y ${p.vidrios[p.vidrios.length - 1]}`;
    lineas.push({
      texto: `Su proyecto combina ${p.vidrios.length} termopaneles distintos: ${lista}. `
        + 'Más abajo se analiza el comportamiento de cada uno.',
      tono: 'dato', size: 8,
    });
  }
  return lineas;
}

/**
 * Arma el PDF del informe térmico de una comuna.
 * @param {object} datos       respuesta de /api/v1/exigencia
 * @param {object} opts        { nombre, firma, esReferenciaRegional }
 * @returns {Promise<Buffer|null>}  null si no hay un solo dato duro que reportar
 */
export async function generarInformeTermicoPdf(datos, { nombre = '', firma = {}, esReferenciaRegional = false, vidrios = null, suVidrio = '', suUw = null, suProducto = '', ventanas = null, laminas = null, termopanel = null, numeroInforme = '' } = {}) {
  if (!datos || !datos.comuna) return null;

  const cond = datos.condensacion;
  const uw = num(datos.uw_max_Wm2K);
  const tienePDA = datos.regimen === 'PDA' && uw > 0;
  const tE = num(cond?.clima?.theta_e_C);
  const hE = num(cond?.clima?.phi_e);
  const t65 = num(cond?.f_rsi_minimo?.['0.65']?.theta_si_min_C);
  const t75 = num(cond?.f_rsi_minimo?.['0.75']?.theta_si_min_C);
  const tieneCond = tE !== null && hE !== null && t65 !== null;

  // Anti-alucinación: sin un solo dato verificado no se emite documento.
  if (!tienePDA && !tieneCond) return null;

  // El glass_label del motor viene como "5+12+5" o "4+12+4 low-e"; las claves del catalogo
  // son "DVH_5-12-5". Se comparan los digitos, que es lo unico estable.
  //
  // 🔴 [2026-08-24, lo cazo el dueno en el PDF real] La version anterior (esSuVidrio, un
  // startsWith de digitos) marcaba TRES filas como "su vidrio": DVH_4-12-4, la INCOLORO
  // FICHA y la LOWE KGLASS empiezan igual. Tres filas resaltadas + un caracter que la
  // fuente no podia dibujar = "genera desconfianza", textual. Ahora se elige UNA: digitos
  // iguales, y ante empate desempata el token low-e (presente o ausente en los dos lados).
  const digitos = (x) => String(x || '').replace(/[^0-9]/g, '');
  const esLowE = (x) => /low.?e|lowe/i.test(String(x || ''));
  const mejorVidrio = () => {
    const d = digitos(suVidrio);
    if (d.length < 3 || !vidrios || typeof vidrios !== 'object') return null;
    const candidatos = Object.entries(vidrios).filter(([cod]) => digitos(cod) === d);
    if (!candidatos.length) return null;
    const conTono = candidatos.filter(([cod, v2]) => esLowE(cod + ' ' + (v2?.desc || '')) === esLowE(suVidrio));
    const [cod, dat] = (conTono[0] || candidatos[0]);
    return { cod, ...dat };
  };
  const { uwCliente } = veredictoUw(suUw, datos.uw_max_Wm2K);
  // [2026-08-24] EL PROYECTO COMPLETO. Si el llamador no manda `ventanas` —el re-envío
  // viejo, o un cliente cuya memoria es anterior a este cambio— se arma una sola fila con
  // lo que sí tenemos, así el informe nunca queda peor que antes.
  const proyecto = resumenVentanas(
    Array.isArray(ventanas) && ventanas.length
      ? ventanas
      : (uwCliente !== null || suVidrio || suProducto
        ? [{ id: 'V1', producto: suProducto, vidrio: suVidrio, uw: suUw }]
        : []),
    datos.uw_max_Wm2K,
  );

  const { default: PDFDocument } = await import('pdfkit');

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      // Ver la lección de la cabecera: los saltos se deciden acá, no los inventa pdfkit.
      doc.page.margins.bottom = 0;
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;

      // ── ENCABEZADO ──────────────────────────────────────────────────────
      doc.rect(0, 0, W, 90).fill(NAVY);
      doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('ACTIVA INVERSIONES', 50, 28);
      doc.fillColor(GOLD).fontSize(10).font('Helvetica').text('Ventanas PVC · Termopanel · Fábrica en Temuco', 50, 56);
      doc.fillColor('#fff').fontSize(9).text('Evaluación energética acreditada MINVU', 50, 72);

      // ── LOGO "EVALUACIÓN ENERGÉTICA" (pedido del dueño, 24-ago) ─────────
      // Las flechas de la etiqueta de eficiencia (A→G), dibujadas en vector — cero
      // imágenes, cero peso. El dueño mandó su firma de correo como referencia y pidió
      // una sola corrección de texto: "cambiar CALIFICADOR energético por EVALUADOR" —
      // acá va la forma sustantiva, EVALUACIÓN ENERGÉTICA, que calza con el cargo real
      // de la firma (Evaluador Energético Externo acreditado MINVU).
      {
        const COLORES = ['#009640', '#52AE32', '#C8D400', '#FFED00', '#FBBA00', '#EB6909', '#E30613'];
        const lx = W - 195, ly = 13;      // esquina del bloque de flechas
        for (let bi = 0; bi < 7; bi++) {
          const bw = 30 + bi * 6;         // cada peldaño un poco más largo, como la etiqueta
          const by = ly + bi * 9.2;
          doc.polygon(
            [lx, by], [lx + bw, by], [lx + bw + 5, by + 3.4], [lx + bw, by + 6.8], [lx, by + 6.8]
          ).fill(COLORES[bi]);
        }
        doc.fillColor('#fff').fontSize(10).font('Helvetica-Bold')
          .text('EVALUACIÓN', W - 112, 32, { width: 102, align: 'left' });
        doc.fillColor(GOLD).fontSize(10).font('Helvetica-Bold')
          .text('ENERGÉTICA', W - 112, 45, { width: 102, align: 'left' });
      }

      doc.fillColor(DARK).fontSize(17).font('Helvetica-Bold')
        .text('INFORME TÉRMICO', 50, 118);
      doc.fillColor(GOLD).fontSize(12)
        .text(esReferenciaRegional ? 'Referencia regional — La Araucanía' : `Comuna de ${datos.comuna}`, 50, 142);
      // [2026-08-24] El correlativo ISO va IMPRESO — igual que la cotizacion imprime el
      // suyo. Un registro cuyo numero no aparece en el documento no amarra nada.
      doc.fillColor(GRAY).fontSize(9).font('Helvetica')
        .text(`Emitido: ${new Date().toLocaleDateString('es-CL')}`
          + `${String(numeroInforme || '').trim() ? `  ·  Informe N° ${String(numeroInforme).trim().slice(0, 40)}` : ''}`
          + `${nombre ? `  ·  Preparado para: ${String(nombre).trim()}` : ''}`, 50, 161);

      // Aclaración de alcance ARRIBA, no en la letra chica: este documento NO es la propuesta.
      doc.rect(50, 178, W - 100, 26).fill('#F7F9FC');
      doc.fillColor(GRAY).fontSize(8).font('Helvetica')
        .text('Este documento informa la exigencia normativa vigente en su comuna. No es una cotización '
          + 'ni contiene precios: su propuesta económica se envía por separado.', 58, 185, { width: W - 116 });

      // ── AVISO LEGAL ─────────────────────────────────────────────────────
      // Pedido del dueño (2026-08-24): *"debería decir que el informe no se puede enviar,
      // copiar, transgredir... es exclusivo para quien lo recibe o se podrían tomar acciones
      // legales"*. Y sacar la palabra "preliminar" del título, que ya se hizo arriba.
      //
      // ⚠️ SE LE ADVIRTIÓ LA TENSIÓN Y DECIDIÓ IGUAL: el motivo declarado por el que esto es
      // un PDF y no un mensaje fue que *se reenvíe* — al marido, al arquitecto, al maestro
      // (ver la cabecera de este archivo). Por eso la redacción NO prohíbe que el cliente lo
      // comparta con quien lo asesora: prohíbe el USO POR TERCEROS —presentarlo como propio,
      // reproducirlo, o usar sus valores ante una autoridad sin ser el destinatario—, que es
      // lo que de verdad hay que proteger. Prohibir el reenvío liso y llano habría matado el
      // efecto que motivó el formato.
      //
      // ⛔ NO SE INVENTA LA RAZÓN SOCIAL NI EL RUT. Se usa el nombre comercial que ya figura
      // en el encabezado, y `EMISOR_RAZON_SOCIAL` permite poner el nombre legal exacto sin
      // tocar código. Poner un "SpA" o un RUT a ojo en un aviso legal sería inventar un dato
      // — justo lo que la regla del proyecto prohíbe, y encima en el párrafo que pretende
      // tener valor jurídico.
      // [2026-08-24, tablero #392] LA RAZÓN SOCIAL Y EL RUT LOS DIO EL DUEÑO, textual:
      // "Activa Inversiones EIRL, RUT 76.486.825-0". No se inventaron — ese era justamente
      // el motivo por el que el aviso legal salió con el nombre comercial y una variable
      // esperando el dato. El RUT se verificó por módulo 11 antes de escribirlo (DV = 0 ✓):
      // un dígito verificador equivocado dentro del párrafo que pretende tener valor
      // jurídico sería peor que no ponerlo.
      // Van como DEFAULT en código (el dato es público y ya está confirmado por el dueño);
      // las env vars quedan por si la sociedad cambia, sin necesidad de deploy.
      const razonSocial = String(process.env.EMISOR_RAZON_SOCIAL || 'Activa Inversiones EIRL').trim();
      const rutEmisor = String(process.env.EMISOR_RUT || '76.486.825-0').trim();
      const destinatario = String(nombre || '').trim();
      const legal = 'DOCUMENTO CONFIDENCIAL — USO EXCLUSIVO DEL DESTINATARIO. '
        + `Este informe fue preparado${destinatario ? ` para ${destinatario}` : ''} y para el proyecto que lo motivó. `
        + `Su contenido, cálculos y figuras son de ${razonSocial}${rutEmisor ? `, RUT ${rutEmisor}` : ''}, `
        + 'y están protegidos por la legislación de '
        + 'Queda prohibida su reproducción total o parcial, su alteración, y su uso por terceros o para un '
        + 'proyecto distinto —incluido presentarlo, o los valores que contiene, ante terceros o autoridades '
        + 'por quien no es el destinatario— sin autorización escrita previa. El uso no autorizado podrá dar '
        + 'lugar a las acciones legales que correspondan.';
      doc.fontSize(8).font('Helvetica');
      const altoLegal = doc.heightOfString(legal, { width: W - 116 });
      doc.rect(50, 208, W - 100, altoLegal + 14).fill('#FDF6E9')
        .strokeColor(GOLD).lineWidth(0.5).rect(50, 208, W - 100, altoLegal + 14).stroke();
      doc.fillColor('#7A5B14').fontSize(8).font('Helvetica')
        .text(legal, 58, 215, { width: W - 116, align: 'justify' });

      let y = 208 + altoLegal + 26;

      // [2026-08-21] El dueno pidio el informe COMPLETO: "entregale el informe real, no importa
      // si son varias hojas". Asi que se deja de pelear por entrar en una pagina y se agrega un
      // salto explicito. La paginacion automatica sigue APAGADA — los cortes los decidimos acá.
      const saltoSiNoCabe = (alto) => {
        if (y + alto <= doc.page.height - 70) return;
        doc.addPage();
        doc.page.margins.bottom = 0;
        y = 60;
      };

      // ── LAS VENTANAS DE SU PROYECTO ─────────────────────────────────────
      // 🔴 [2026-08-24] UNA FILA POR VENTANA. Pedido del dueño, textual: *"no podemos
      // cotizarle una ventana al cliente teniendo ocho ventanas con transmitancias térmicas
      // [distintas]"*. Antes se dibujaba UN recuadro con el Uw de `items[0]` rotulado en
      // singular, y las otras siete no existían para el documento.
      //
      // Las filas sin Uw NO se omiten: se rotulan "perfil en certificación" (redacción
      // aprobada por el dueño). Omitirlas haría parecer que el proyecto tiene menos
      // ventanas de las que tiene, y eso es peor que decir la verdad.
      if (proyecto.filas.length) {
        // 🔴 [2026-08-24 · Codex, 2a pasada] EL SINGULAR SE DECIDE POR UNIDADES, NO POR
        // FILAS. Con `filas.length === 1`, una sola partida de 4 unidades caia en el
        // recuadro "LA VENTANA DE SU COTIZACION": sin el ×4, sin el encabezado "4 ventanas"
        // y sin sintesis. El cliente compra cuatro y el documento le hablaba de una. Que la
        // cotizacion las haya agrupado en una linea es un detalle nuestro, no del proyecto.
        const unaSola = proyecto.filas.length === 1 && proyecto.totalVentanas === 1;
        const titulo = unaSola ? 'LA VENTANA DE SU COTIZACIÓN' : 'LAS VENTANAS DE SU PROYECTO';

        // Encabezado azul con el resumen del conjunto.
        doc.rect(50, y, W - 100, unaSola ? 54 : 32).fill('#0B3D6F');
        doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold').text(titulo, 60, y + 8);
        if (!unaSola) {
          const nVent = `${proyecto.totalVentanas} ventana${proyecto.totalVentanas === 1 ? '' : 's'}`;
          const exig = proyecto.exigencia !== null ? `  ·  exigencia ${dec(proyecto.exigencia)} W/m²K` : '';
          doc.fillColor('#cbd5e1').fontSize(8).font('Helvetica')
            .text(`${nVent}${exig}`, W - 300, y + 8, { width: 240, align: 'right' });
          y += 40;
        }

        if (unaSola) {
          // Una sola ventana: el recuadro grande de siempre, que se lee mejor que una tabla
          // de una fila.
          const f = proyecto.filas[0];
          doc.fillColor('#fff').fontSize(9).font('Helvetica')
            .text(String(f.producto || 'Ventana PVC termopanel').slice(0, 58), 60, y + 22, { width: 260 });
          if (f.vidrio) {
            doc.fillColor('#cbd5e1').fontSize(8).text(`Vidrio: ${f.vidrio}`, 60, y + 36, { width: 260 });
          }
          if (f.uw !== null) {
            doc.fillColor('#fff').fontSize(8).font('Helvetica').text('Uw calculado', 340, y + 12, { width: 90 });
            doc.fillColor(f.cumple === false ? '#fca5a5' : '#86efac').fontSize(20).font('Helvetica-Bold')
              .text(`${dec(f.uw, 2)}`, 340, y + 24, { width: 90 });
            doc.fillColor('#cbd5e1').fontSize(8).font('Helvetica').text('W/m²K', 393, y + 33);
          } else if (f.motivo) {
            doc.fillColor('#cbd5e1').fontSize(8).font('Helvetica-Oblique')
              .text(f.motivo, 340, y + 26, { width: 150 });
          }
          if (f.cumple !== null) {
            doc.fillColor(f.cumple ? '#86efac' : '#fca5a5').fontSize(10).font('Helvetica-Bold')
              .text(f.cumple ? 'CUMPLE' : 'NO CUMPLE', W - 175, y + 20, { width: 115, align: 'right' });
            doc.fillColor('#cbd5e1').fontSize(8).font('Helvetica')
              .text(`exigencia ${dec(proyecto.exigencia)} W/m²K`, W - 175, y + 36, { width: 115, align: 'right' });
          }
          y += 68;
        } else {
          // Tabla. Columnas en x fijos para que Uw y veredicto queden alineados a la vista.
          const X = { id: 58, prod: 86, med: 300, vid: 370, uw: 440, ver: W - 145 };
          doc.fillColor(GRAY).fontSize(7).font('Helvetica-Bold');
          doc.text('N°', X.id, y); doc.text('VENTANA', X.prod, y);
          doc.text('MEDIDAS', X.med, y); doc.text('VIDRIO', X.vid, y);
          doc.text('Uw', X.uw, y, { width: 46, align: 'right' });
          doc.text('NORMA', X.ver, y, { width: 85, align: 'right' });
          y += 11;
          doc.strokeColor('#d7dee7').lineWidth(0.5).moveTo(50, y).lineTo(W - 50, y).stroke();
          y += 5;

          for (const f of proyecto.filas) {
            saltoSiNoCabe(26);
            const alto = 20;
            if (f.cumple === false) doc.rect(50, y - 3, W - 100, alto).fill('#fdf0ef');

            doc.fillColor(GRAY).fontSize(8).font('Helvetica-Bold').text(f.id, X.id, y);
            const rotulo = f.cantidad > 1 ? `${f.producto}  (×${f.cantidad})` : f.producto;
            doc.fillColor(DARK).fontSize(8).font('Helvetica')
              .text(rotulo.slice(0, 46), X.prod, y, { width: 210, lineBreak: false });
            if (f.ambiente) {
              doc.fillColor(GRAY).fontSize(6.5)
                .text(f.ambiente.slice(0, 30), X.prod, y + 9, { width: 210, lineBreak: false });
            }
            doc.fillColor(GRAY).fontSize(8).font('Helvetica')
              .text(f.medidas.slice(0, 13) || '—', X.med, y, { width: 66, lineBreak: false });
            doc.text(f.vidrio.slice(0, 13) || '—', X.vid, y, { width: 66, lineBreak: false });

            if (f.uw !== null) {
              doc.fillColor(f.cumple === false ? '#b91c1c' : DARK).fontSize(9).font('Helvetica-Bold')
                .text(dec(f.uw, 2), X.uw, y - 1, { width: 46, align: 'right' });
            } else {
              // No es un hueco: es una explicación. El cliente tiene que entender que la
              // ventana existe y que el número está pendiente de NUESTRO lado.
              doc.fillColor(GRAY).fontSize(6.5).font('Helvetica-Oblique')
                .text(f.motivo, X.uw - 20, y + 1, { width: 150, lineBreak: false });
            }
            if (f.cumple !== null) {
              doc.fillColor(f.cumple ? '#0a7d33' : '#b91c1c').fontSize(8).font('Helvetica-Bold')
                .text(f.cumple ? 'cumple' : 'NO cumple', X.ver, y, { width: 85, align: 'right' });
            }
            y += alto;
            doc.strokeColor('#eef2f6').lineWidth(0.5).moveTo(50, y - 4).lineTo(W - 50, y - 4).stroke();
          }
          y += 4;

          // Síntesis honesta del conjunto. La REDACCION vive en `sintesisProyecto`, que es
          // pura y esta cubierta por tests: lo que va firmado tiene que ser testeable, y
          // dentro del dibujo del PDF no lo era.
          const COLOR_TONO = { ok: '#0a7d33', alerta: '#b91c1c', neutro: GRAY, dato: DARK };
          for (const linea of sintesisProyecto(proyecto)) {
            saltoSiNoCabe(34);
            doc.fillColor(COLOR_TONO[linea.tono] || DARK).fontSize(linea.size)
              .font(linea.size >= 9 ? 'Helvetica-Bold' : 'Helvetica');
            doc.text(linea.texto, 58, y, { width: W - 116 });
            y = doc.y + 8;
          }
          y += 4;
        }
      }

      const seccion = (titulo) => {
        saltoSiNoCabe(60);
        doc.moveTo(50, y).lineTo(W - 50, y).strokeColor(GOLD).lineWidth(1).stroke();
        y += 10;
        doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(titulo, 50, y);
        y += 20;
      };
      const parrafo = (txt, { bold = false, color = DARK, size = 10 } = {}) => {
        saltoSiNoCabe(size * 3);
        doc.fillColor(color).fontSize(size).font(bold ? 'Helvetica-Bold' : 'Helvetica');
        doc.text(txt, 50, y, { width: W - 100, align: 'justify' });
        y = doc.y + 8;
      };
      const dato = (etiqueta, valor) => {
        saltoSiNoCabe(26);
        doc.fillColor(GRAY).fontSize(9).font('Helvetica').text(etiqueta, 55, y + 6, { width: 230 });
        doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold').text(valor, 290, y + 3, { width: W - 345, align: 'right' });
        y += 25;
      };

      // ═══ GRÁFICOS ═══════════════════════════════════════════════════════
      // [2026-08-21] Pedido del dueño: "pensé que tendría gráficas para que se vea
      // impresionante". Se dibujan con primitivas de pdfkit (rect + text): sin librerías,
      // sin imágenes externas, sin peso extra.
      // ⚠️ TODO SALE DE DATOS VERIFICADOS DE THERMAL. No hay ni una comparación inventada
      // —nada de "el aluminio da 5,8"— porque ese número no lo tenemos medido y este
      // documento va firmado. Se grafica lo que la API entrega y nada más.

      /** Escala de temperatura: dónde tiene que mantenerse la cara interior del vidrio. */
      const graficoCondensacion = () => {
        const alto = 96;
        saltoSiNoCabe(alto + 20);
        const x0 = 60, ancho = W - 120, yBar = y + 30, hBar = 20;
        // El rango se arma con los datos reales, con un margen a cada lado.
        const min = Math.floor(tE - 2);
        const max = 21;
        const px = (t) => x0 + ((t - min) / (max - min)) * ancho;

        // Zona de condensación (desde el mínimo hasta el umbral de 65 %) en rojo suave.
        doc.rect(x0, yBar, px(t65) - x0, hBar).fill('#f3d0cd');
        // Zona segura.
        doc.rect(px(t65), yBar, x0 + ancho - px(t65), hBar).fill('#d6ecd9');
        doc.rect(x0, yBar, ancho, hBar).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

        const marca = (t, etiqueta, color, arriba) => {
          const xx = px(t);
          doc.moveTo(xx, yBar - (arriba ? 8 : 0)).lineTo(xx, yBar + hBar + (arriba ? 0 : 8))
            .strokeColor(color).lineWidth(1.5).stroke();
          doc.fillColor(color).fontSize(8).font('Helvetica-Bold');
          doc.text(etiqueta, xx - 45, arriba ? yBar - 20 : yBar + hBar + 10, { width: 90, align: 'center' });
        };
        marca(tE, `Exterior ${dec(tE)} °C`, '#2563eb', true);
        marca(t65, `Condensa bajo ${dec(t65)} °C`, '#b91c1c', false);
        if (t75 !== null) marca(t75, `Con 75 % HR: ${dec(t75)} °C`, '#c2410c', true);
        marca(19, 'Interior 19 °C', '#0a7d33', false);

        doc.fillColor('#b91c1c').fontSize(8).font('Helvetica-Bold')
          .text('CONDENSA', x0 + 4, yBar + 6);
        doc.fillColor('#0a7d33')
          .text('SIN CONDENSACIÓN', px(t65) + 6, yBar + 6);
        y += alto;
      };

      /** Barras horizontales de Ug: cuanto más corta, mejor aísla. */

      // ── 1. EXIGENCIA ────────────────────────────────────────────────────
      seccion('1 · QUÉ EXIGE LA NORMA EN SU COMUNA');
      if (esReferenciaRegional) {
        parrafo(`No contamos aún con su comuna, así que este informe toma ${datos.comuna} como referencia `
          + 'por ser la capital regional. Al confirmarnos su comuna se emite el informe exacto: la '
          + 'exigencia cambia de una comuna a otra.', { color: GRAY, size: 9 });
      }
      if (tienePDA) {
        dato('Régimen aplicable', 'Plan de Descontaminación (PDA)');
        dato('Transmitancia máxima admisible (Uw)', `${dec(uw)} W/m²K`);
        dato('Zona térmica (NCh 1079)', String(datos.zona_termica_NCh1079 || '—'));
        y += 2;
        parrafo(esReferenciaRegional
          ? `En ${datos.comuna} este tope es obligatorio por decreto. En otras comunas de la región no `
            + 'rige, aunque las condiciones de frío sean equivalentes.'
          : 'Este tope no es una recomendación: es una exigencia por elemento establecida por decreto. '
            + 'Una ventana que lo supere no cumple la norma vigente en su comuna.');
        if (datos.criterio_ref) parrafo(`Referencia: ${datos.criterio_ref}`, { color: GRAY, size: 8 });
      } else {
        dato('Régimen aplicable', 'Reglamentación Térmica (OGUC 4.1.10)');
        dato('Zona térmica (NCh 1079)', String(datos.zona_termica_NCh1079 || '—'));
        y += 4;
        parrafo('En su comuna no rige un tope de transmitancia por ventana; la exigencia opera sobre el '
          + 'porcentaje máximo de superficie vidriada. Las condiciones de frío y humedad, sin embargo, '
          + 'son las mismas que en las comunas con Plan de Descontaminación.');
      }

      // ── 2. CONDENSACIÓN ─────────────────────────────────────────────────
      if (tieneCond) {
        y += 6;
        seccion('2 · RIESGO DE CONDENSACIÓN');
        parrafo('La condensación —el agua que aparece en el vidrio— ocurre cuando la superficie interior '
          + 'baja de cierta temperatura. Ese umbral depende del clima de su comuna y de la humedad '
          + 'dentro de la vivienda.');
        y += 2;
        dato(`Clima exterior de referencia — ${datos.comuna}`, `${dec(tE)} °C  ·  ${Math.round(hE * 100)} % HR`);
        dato('Temperatura interior considerada', '19 °C');
        dato('Umbral con 65 % de humedad interior', `${dec(t65)} °C`);
        if (t75 !== null) dato('Umbral con 75 % de humedad interior', `${dec(t75)} °C`);
        y += 2;
        parrafo(`Con 19 °C interiores y 65 % de humedad, si la cara interior del vidrio baja de `
          + `${dec(t65)} °C se produce condensación.`
          + (t75 !== null
            ? ` En recintos con más humedad —cocina, baño, ropa secándose— el umbral sube a ${dec(t75)} °C, `
              + 'es decir, condensa más fácil.'
            : ''), { bold: true });
        y += 4;
        graficoCondensacion();
        if (cond?.metodo) parrafo(`Método: ${cond.metodo}`, { color: GRAY, size: 8 });
      }

      // ── 3. SU TERMOPANEL, PASADO POR NUESTRO MOTOR ──────────────────────
      //
      // [2026-08-24] Decision del dueno, textual: *"lo de los vidrios igual esta mal,
      // genera desconfianza; yo pasaria el termopanel por una isoterma y entregaria lo que
      // me dio nuestro motor"*. Y tenia DOS razones medibles: el resaltado marcaba TRES
      // filas como "su vidrio" (el startsWith de digitos no distinguia 4-12-4 de sus
      // variantes) y el marcador era un caracter que la fuente no puede dibujar — en el
      // PDF real salia "%¶". Un catalogo de 10 vidrios ajenos con eso encima se leia como
      // folleto defectuoso, exactamente lo contrario de lo que el informe vino a lograr.
      //
      // Lo que va en su lugar: LA FIGURA DEL MOTOR (borde del termopanel, aluminio vs
      // warm-edge, con isotermas, f_Rsi y Psi calculados) + UNA linea con el vidrio del
      // cliente y su respaldo. El resto del catalogo murio: comparar 10 vidrios es trabajo
      // del vendedor, no del documento firmado.
      // Numeracion por contador: si una seccion no aplica, la siguiente no salta numero.
      let nSec = 2;
      const suV = mejorVidrio();
      const figTermo = termopanel && termopanel.lamina && termopanel.lamina.png ? termopanel : null;
      const dimT = figTermo ? medirPng(figTermo.lamina.png) : null;
      const termoDibujable = Boolean(
        figTermo && dimT && (dimT.ancho * dimT.alto) / 1e6 <= MAX_MPX_FIGURA
        && String(figTermo.nombre || '').trim()
      );
      if (termoDibujable || suV) {
        y += 6;
        seccion(`${++nSec} · ANÁLISIS TÉRMICO DEL BORDE DE SU TERMOPANEL`);
        if (suV) {
          const respaldo = String(suV.estado || '').toUpperCase() === 'CERTIFICADO'
            ? 'con Ug certificado por informe de ensayo del fabricante'
            : 'con Ug de ficha técnica del fabricante';
          parrafo(`Su cotización considera el vidrio ${String(suV.cod).replace(/_/g, ' ')}`
            + `${num(suV.Ug) !== null ? ` (Ug ${dec(suV.Ug, 2)} W/m²K, ${respaldo})` : ''}. `
            + 'El dato es de origen, no una estimación nuestra.', { size: 9 });
          y += 2;
        }
        if (termoDibujable) {
          // 🔴 [2026-08-24] SE ACABÓ LA PÁGINA ROTADA. El dueño lo cazó mirando el PDF en el
          // teléfono: *"diste vuelta la hoja; cuando un cliente usa celular normalmente no
          // podrá verlo, se le comenzará a dar vuelta"*. Y tiene razón: rotar el CONTENIDO
          // dentro de una hoja vertical es lo peor de los dos mundos — el visor la sigue
          // tratando como página vertical y el auto-giro del teléfono pelea con la imagen.
          //
          // La solución tiene DOS partes, y la primera es la que de verdad resuelve:
          //   1. LOS NÚMEROS COMO TEXTO, EN VERTICAL. Lo que el cliente necesita leer no es
          //      la imagen: son los valores. Vienen del endpoint (cálculo), NUNCA de leer la
          //      figura, y se dibujan como tabla nativa a tamaño completo.
          //   2. LA FIGURA EN SU PROPIA PÁGINA APAISADA DE VERDAD (`layout: 'landscape'`),
          //      no con el contenido girado: el visor sabe que es apaisada y la muestra como
          //      corresponde. Si el cliente solo mira los números, ya tiene lo que importa.
          const r = figTermo.resultados || null;
          const n2 = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
          const psiAlu = n2(r?.psi_borde_aluminio_W_mK);
          const psiTf = n2(r?.psi_borde_thermoflex_W_mK);
          const redu = n2(r?.reduccion_psi_pct);
          const ugDecl = n2(r?.Ug_declarado_W_m2K);

          if (psiAlu !== null && psiTf !== null) {
            parrafo('Comparación calculada sobre el borde de su termopanel, con un separador y con el otro:',
              { size: 9 });
            const filaCmp = (etq, val, unidad, destacar) => {
              saltoSiNoCabe(22);
              if (destacar) doc.rect(50, y - 2, W - 100, 20).fill('#eefaf1');
              doc.fillColor(destacar ? '#0a7d33' : DARK).fontSize(10)
                .font(destacar ? 'Helvetica-Bold' : 'Helvetica')
                .text(etq, 58, y + 3, { width: 280 });
              doc.fillColor(destacar ? '#0a7d33' : DARK).fontSize(11).font('Helvetica-Bold')
                .text(val, 340, y + 2, { width: 90, align: 'right' });
              doc.fillColor(GRAY).fontSize(8).font('Helvetica')
                .text(unidad, 438, y + 5, { width: W - 495 });
              y += 21;
            };
            filaCmp('Con separador de ALUMINIO (el habitual del mercado)', dec(psiAlu, 4), 'W/m·K', false);
            filaCmp('Con separador WARM-EDGE (el que lleva su ventana)', dec(psiTf, 4), 'W/m·K', true);
            if (redu !== null) {
              y += 2;
              doc.fillColor('#0a7d33').fontSize(12).font('Helvetica-Bold')
                .text(`${dec(redu, 0)} % menos pérdida por el borde con warm-edge`, 58, y, { width: W - 116 });
              y += 20;
            }
            if (ugDecl !== null) {
              doc.fillColor(GRAY).fontSize(8).font('Helvetica')
                .text(`Cálculo sobre su vidriado, con el Ug ${dec(ugDecl, 3)} W/m²K declarado por el fabricante`
                  + `${String(r?.estado_del_Ug || '').toUpperCase() === 'CERTIFICADO' ? ' y respaldado por certificado de ensayo' : ''}.`,
                  58, y, { width: W - 116 });
              y += 16;
            }
            y += 4;
          }

          parrafo('La figura completa del cálculo —isotermas del corte y tabla de resultados— va en la '
            + 'página siguiente, en formato apaisado.', { size: 9, color: GRAY });

          // La figura, en una página APAISADA DE VERDAD.
          const dimT2 = medirPng(figTermo.lamina.png);
          doc.addPage({ size: 'A4', layout: 'landscape' });
          doc.page.margins.bottom = 0;
          const AW = doc.page.width, AH = doc.page.height;
          const pieT = 'Cálculo por elementos finitos sobre el borde de su termopanel: el mismo corte '
            + 'resuelto con separador de aluminio (izquierda) y con separador warm-edge (derecha) — el '
            + 'separador es el marco que va dentro del termopanel manteniendo los dos vidrios a distancia. '
            + 'Los valores de la comparación se informan en la página anterior.';
          try {
            doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold')
              .text(String(figTermo.nombre || '').trim().slice(0, 90), 40, 28, { width: AW - 80 });
            doc.image(figTermo.lamina.png, 40, 50, {
              fit: [AW - 80, AH - 110], align: 'center', valign: 'center',
            });
            doc.fillColor(GRAY).fontSize(8).font('Helvetica')
              .text(pieT, 40, AH - 52, { width: AW - 80 });
          } catch { /* una figura rota no puede costar el informe */ }

          doc.addPage();
          doc.page.margins.bottom = 0;
          y = 60;
        }
      }

      // ── 4. QUÉ SIGNIFICA ────────────────────────────────────────────────
      y += 6;
      seccion(`${++nSec} · QUÉ SIGNIFICA PARA SU PROYECTO`);
      parrafo('Una ventana de PVC con termopanel mantiene la cara interior del vidrio por encima de esos '
        + 'umbrales, incluso en las noches más frías. Un perfil de aluminio sin rotura de puente térmico, '
        + 'o un vidrio simple, no lo consigue: por eso amanecen mojados. En la propuesta que recibirá a '
        + 'continuación se indica la transmitancia (Uw) calculada para sus ventanas y si cumple.');

      // ── 5. ISOTERMAS DEL CORTE REAL (FEM de ACTIVA THERMAL) ─────────────
      //
      // [2026-08-24] Pedido del dueño: *"tan pequeño sabiendo que puedes pasarle el FEM al
      // termopanel para ver la isoterma"*. El informe pesaba 9 KB mientras THERMAL ya tenía
      // 7 figuras del corte real con las isotermas cada 1 °C, aprobadas y firmadas.
      //
      // 🔴 CÓMO SE ROTULAN, Y POR QUÉ NO ES NEGOCIABLE. Cada PNG viaja con la cabecera
      // `X-No-Declarable: true` y THERMAL lo dice en su propia respuesta: *"figuras
      // ilustrativas; los valores declarables salen del cálculo"*. Entonces:
      //   · se nombra EL PERFIL que se está mostrando (hoy el único con láminas es el
      //     S60 proyectante) — dejar que el cliente asuma que es SU ventana sería
      //     afirmarle algo que el proveedor no respalda;
      //   · se dice explícitamente que el número sale del cálculo, no de mirar la figura.
      // Sacar cualquiera de las dos cosas convierte un argumento técnico en una promesa
      // falsa, y es exactamente lo que la regla anti-alucinación del proyecto prohíbe.
      const figuras = Array.isArray(laminas?.laminas) ? laminas.laminas.filter((l) => l && l.png) : [];
      // 🔴 [P0 · hallazgo de Gemini, 24-ago] EL NOMBRE DEL PERFIL ES CONDICIÓN, NO ADORNO.
      // Antes el bloque se dibujaba con `if (figuras.length)` y la advertencia colgaba de un
      // `if (laminas?.nombre)` aparte: si THERMAL devolvía un perfil con los nombres vacíos,
      // las isotermas salían SIN ROTULAR dentro de un informe firmado por un evaluador
      // acreditado MINVU. Tres cortes térmicos a color y ni una línea que los relativice ⇒
      // el cliente asume que le simularon SU ventana.
      // Se prefiere un informe SIN figuras a un informe con figuras que induzcan a error:
      // si no podemos decir QUÉ estamos mostrando, no se muestra.
      // [P1 · Codex] `.trim()` y cae al id del perfil: un nombre de solo espacios pasaba el
      // truthy y salia 'Corte del sistema   ' — rotulo vacio es lo mismo que sin rotulo.
      const idPerfil = String(laminas?.nombre || '').trim() || String(laminas?.perfil || '').trim();
      if (figuras.length && idPerfil) {
        seccion(`${++nSec} · CÓMO SE COMPORTA EL PERFIL POR DENTRO`);
        parrafo('Estas figuras salen del cálculo por elementos finitos del perfil: cada línea une los '
          + 'puntos que están a la misma temperatura. Donde las líneas se juntan, el calor escapa más '
          + 'rápido; donde se separan, el perfil aísla.');
        {
          // [P1 · Gemini] SE DICE QUÉ TIPO DE VENTANA ES LA DE LA FIGURA.
          // Hoy THERMAL publica láminas de UN solo sistema (S60 proyectante) y el producto
          // más vendido es la corredera. Decir solo "figura ilustrativa" no alcanza: el
          // cliente que cotizó una corredera necesita saber que el corte que está viendo
          // no es el de su tipo de ventana. Se declara el hecho —qué sistema se ilustra—
          // sin afirmar nada comparativo sobre el rendimiento de un tipo frente al otro,
          // porque eso no lo respalda esta figura.
          // [P2 · Codex] Los campos vienen de una API ajena: se ACOTAN. Un `nombre` de 1000
          // caracteres empujaba el rotulo varias lineas y la imagen se dibujaba encima.
          const corto = (x, n) => String(x || '').trim().slice(0, n);
          // [2026-08-24] Registro PROFESIONAL, pedido del dueno: "el lenguaje debe ser mas
          // correcto, mas profesional". La honestidad se mantiene entera (caracter referencial,
          // no es la simulacion de SU ventana, el Uw sale del calculo) — cambia el tono.
          const aviso = `Figuras elaboradas con nuestro motor de cálculo por elementos finitos sobre el `
            + `sistema ${corto(idPerfil, 80)}`
            + `${corto(laminas.aprobadoPor, 60) ? `, modelo aprobado por ${corto(laminas.aprobadoPor, 60)}` : ''}`
            + `${corto(laminas.fecha, 20) ? ` (${corto(laminas.fecha, 20)})` : ''}. `
            + 'Tienen carácter referencial: representan el comportamiento térmico del sistema indicado y '
            + 'no constituyen una simulación de su ventana en particular. Si su cotización considera otro '
            + 'tipo de apertura —por ejemplo, corredera— el perfil de su ventana difiere del ilustrado. '
            + 'Los valores declarables de su proyecto (Uw) provienen del cálculo normativo conforme a '
            + 'NCh 3137.';
          doc.fillColor(GRAY).fontSize(8).font('Helvetica');
          // El alto REAL del rotulo, con la fuente ya fijada en 8 (heightOfString usa la
          // fuente actual del documento; pasarle `fontSize` como opcion no hace nada).
          const altoAviso = doc.heightOfString(aviso, { width: W - 100 });
          saltoSiNoCabe(altoAviso + 20);
          doc.text(aviso, 50, y, { width: W - 100 });
          y += altoAviso + 18;
        }

        for (const f of figuras) {
          const pie = PIES_LAMINA[f.id] || '';
          // Se mide la imagen para reservar el alto EXACTO antes de decidir el salto de
          // página: la paginación automática está apagada a propósito en este documento.
          const dim = medirPng(f.png);
          // 🔴 [hallazgo de Codex, medido] TOPE POR MEGAPÍXELES, también acá.
          // `laminasThermal` ya lo filtra, pero esta función acepta `laminas` de cualquier
          // llamador y el costo de equivocarse no es un PDF feo: un PNG de 10000x10000 RGBA
          // entra bajo cualquier techo de bytes y se come ~1,4 GB al decodificarse ⇒ mata el
          // proceso del bot y se cae la atención de TODOS los clientes, no solo este informe.
          // Medido: 3000x3000 RGBA = 34 KB en disco → +129 MB de RSS.
          if (dim && (dim.ancho * dim.alto) / 1e6 > MAX_MPX_FIGURA) continue;
          const anchoUtil = W - 100;
          const alto = dim ? Math.min(Math.round(anchoUtil * (dim.alto / dim.ancho)), 430) : 300;
          saltoSiNoCabe(alto + (pie ? 40 : 16));
          try {
            doc.image(f.png, 50, y, { fit: [anchoUtil, alto], align: 'center' });
          } catch {
            // Una figura que no se puede dibujar NO puede costarle el informe al cliente.
            continue;
          }
          y += alto + 8;
          if (pie) {
            doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(pie, 50, y, { width: anchoUtil });
            y += doc.heightOfString(pie, { width: anchoUtil }) + 14;
          }
        }
      }

      // ── VALIDACIÓN DEL MOTOR (pedido del dueño, 24-ago) ─────────────────
      //
      // Textual: *"deberíamos decir que nuestro modelo de cálculo cumple con las 28 pruebas
      // que indica la normativa ISO 10077-1 y 2, homóloga norma chilena 3137-1 y 2… para que
      // el modelo esté validado, pero como algo que sea creíble, impactante"*.
      //
      // 🔴 LAS 28 SON REALES Y SE VERIFICARON ANTES DE IMPRIMIRLAS. No se tomó el número
      // porque el dueño lo dijera: se consultó `GET /api/v1/validacion` de ACTIVA THERMAL,
      // que es público a propósito para que un tercero pueda auditarlo, y la suma da 28/28:
      //     Anexo F/I ................. 10/10   (±3 % en L2D, cláusula 5.3)
      //     Anexo E/H con radiosidad ... 11/11   (±3 % en L2D · desbalance ≤ 0,5 %)
      //     Anexo G1 ................... 4/4     (flujo: piso ±3 % / vendor ±1 %)
      //     Anexo G2-G3-G4 ............. 3/3     (flujo ±1 % · temperatura ±0,03 K)
      // más el caso 1 analítico de NCh 3136 (±0,1 K): conforme.
      //
      // ⚠️ SE RESPETA LA ADVERTENCIA DE LA PROPIA API: *"el render NO produce valores
      // declarables"*. Por eso el bloque habla de LA VALIDACIÓN DEL MOTOR, no de que las
      // figuras sean declarables — son dos cosas distintas y confundirlas sería el mismo
      // error que veníamos corrigiendo, al revés.
      y += 6;
      seccion(`${++nSec} · POR QUÉ PUEDE CONFIAR EN ESTOS NÚMEROS`);
      parrafo('El motor de cálculo con el que se hizo este informe está validado contra la batería '
        + 'completa de casos de referencia de la norma: 28 pruebas, 28 aprobadas.', { bold: true, size: 10 });
      {
        const filas = [
          ['Anexo F / I — transmisión bidimensional', '10 de 10', 'tolerancia ±3 % en L2D (cláusula 5.3)'],
          ['Anexo E / H — cavidades con radiosidad', '11 de 11', 'tolerancia ±3 % · desbalance ≤ 0,5 %'],
          ['Anexo G1 — flujos de referencia', '4 de 4', 'tolerancia ±1 % nivel fabricante'],
          ['Anexo G2·G3·G4 — casos combinados', '3 de 3', 'flujo ±1 % · temperatura ±0,03 K'],
        ];
        for (const [caso, res, tol] of filas) {
          saltoSiNoCabe(20);
          doc.fillColor(DARK).fontSize(9).font('Helvetica').text(caso, 55, y + 3, { width: 230 });
          doc.fillColor('#0a7d33').fontSize(9).font('Helvetica-Bold').text(res, 290, y + 3, { width: 55 });
          doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(tol, 350, y + 4, { width: W - 405 });
          y += 18;
        }
        y += 6;
        parrafo('Esos casos son los que la norma ISO 10077-2 —homologada en Chile como NCh 3137/2— '
          + 'define para comprobar que un programa de cálculo entrega resultados correctos. Nuestro motor '
          + 'los reproduce dentro de la tolerancia exigida, y además supera el caso analítico de NCh 3136 '
          + '(±0,1 K). La validación es auditable por un tercero: se publica y puede consultarse.',
          { size: 9, color: GRAY });
      }

      // ── ALCANCE ─────────────────────────────────────────────────────────
      // Decir QUE NO cubre el informe es lo que lo vuelve creible. Un documento que promete
      // todo se lee como folleto; uno que declara sus limites se lee como informe tecnico.
      // El texto sale de la propia API (`que_NO_verifica`), no se inventa.
      const noCubre = []
        .concat(Array.isArray(datos.que_NO_verifica) ? datos.que_NO_verifica : [])
        .concat(Array.isArray(cond?.que_NO_verifica) ? cond.que_NO_verifica : [])
        .map((x) => String(x).split(' (usar ')[0].split(': ver ')[0].trim())
        .filter((x) => x && x.length < 130)
        .slice(0, 6);
      if (noCubre.length) {
        y += 6;
        seccion(`${++nSec} · ALCANCE DE ESTE INFORME`);
        parrafo('Este documento cubre la exigencia aplicable a las VENTANAS. No verifica:', { size: 9 });
        doc.fillColor(GRAY).fontSize(8).font('Helvetica');
        for (const item of noCubre) {
          saltoSiNoCabe(14);
          doc.text(`•  ${item}`, 55, y, { width: W - 110 });
          y = doc.y + 3;
        }
        y += 4;
        parrafo('La evaluación completa de la envolvente (muros, techumbre, pisos) y la acreditación '
          + 'ante el permiso de edificación se realizan por separado. Consúltenos si su proyecto lo requiere.',
        { size: 8, color: GRAY });
      }

      // ── FIRMA ───────────────────────────────────────────────────────────
      // El bloque de firma mide ~95 px (separador + nombre + cargo + resolución + teléfono) y
      // el pie arranca en height-52. Reservar 210 como antes mandaba la firma a una segunda
      // página VACÍA de contenido — el mismo síntoma del bug de las cotizaciones, medido acá:
      // 2 páginas donde la 2ª solo tenía la firma. Un informe preliminar entra en una hoja.
      saltoSiNoCabe(110);
      y += 12;
      doc.moveTo(50, y).lineTo(W - 50, y).strokeColor(GOLD).lineWidth(1).stroke();
      y += 16;
      doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
        .text(firma.nombre || 'Ing. Marcelo Cifuentes Méndez', 50, y);
      y = doc.y + 2;
      doc.fillColor(GRAY).fontSize(9).font('Helvetica')
        .text(firma.cargo || 'Evaluador Energético Externo acreditado MINVU', 50, y, { width: W - 100 });
      y = doc.y + 1;
      if (firma.resolucion) {
        doc.fillColor(GRAY).fontSize(9).text(firma.resolucion, 50, y, { width: W - 100 });
        y = doc.y + 1;
      }
      doc.fillColor(GRAY).fontSize(8)
        .text('Consultas técnicas: +56 9 5729 6035', 50, y + 4);

      // ── PIE EN TODAS LAS PÁGINAS ────────────────────────────────────────
      // Con varias hojas, un pie solo en la última deja las anteriores sin identificar. Se
      // recorre el buffer de páginas al final, que es la forma que soporta pdfkit.
      const pie = { align: 'center', width: W - 100, lineBreak: false };
      const rango = doc.bufferedPageRange();
      for (let i = rango.start; i < rango.start + rango.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        doc.rect(0, doc.page.height - 52, W, 52).fill(NAVY);
        doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold')
          .text('Activa Inversiones · Fábrica de Ventanas y Puertas PVC · Temuco', 50, doc.page.height - 42, pie);
        doc.fillColor(GOLD).fontSize(8).font('Helvetica')
          .text(`www.activaspa.cl  ·  Informe preliminar sin costo  ·  Página ${i - rango.start + 1} de ${rango.count}`,
            50, doc.page.height - 26, pie);
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export default { generarInformeTermicoPdf, VERSION };
