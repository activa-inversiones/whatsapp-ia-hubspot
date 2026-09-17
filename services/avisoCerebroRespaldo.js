// services/avisoCerebroRespaldo.js — AVISARLE AL DUEÑO CUANDO OLIVER CAE AL CEREBRO DE RESPALDO.
//
// 🔴 EL PROBLEMA MEDIDO (17-sep, contra la BD viva): en los últimos 30 días Oliver
// contestó 74 mensajes con el cerebro de RESPALDO en vez del principal, en cinco
// episodios (5, 6, 7, 14 y 15 de septiembre), y los 74 por la MISMA causa:
// "credit balance is too low". El 6-sep fue el día entero — cero mensajes por el
// cerebro principal y 31 por el respaldo.
//
// 🔴 Y NADIE SE ENTERÓ. El respaldo funciona en silencio: el dato quedaba escrito
// en `metadata.cerebro` de cada mensaje y ninguna pantalla lo miraba. El dueño se
// enteró el 17-sep porque se estaba midiendo otra cosa. Un respaldo que no avisa
// no es un respaldo: es una degradación invisible sobre clientes reales, con un
// modelo distinto a aquel sobre el que está calibrado todo el prompt.
//
// Este módulo es PURO (arma el texto y decide la llave). El envío y el throttle
// los hace el webhook, con el mismo patrón ya probado de `avisoEntregaDudosa`.

/** Una vez por día y por causa: el dueño no necesita 31 avisos, necesita UNO. */
export const RESPALDO_REPETIR_MS = 24 * 3600 * 1000;

/**
 * Clasifica el motivo crudo del proveedor en algo accionable.
 * 🔴 NO se devuelve el motivo crudo a ciegas: viene de la API y puede traer
 * cabeceras, ids o fragmentos de payload. Acá se reduce a una de tres familias.
 */
export function causaDelRespaldo(motivo) {
  const m = String(motivo || '').toLowerCase();
  if (m.includes('credit balance') || m.includes('insufficient') || m.includes('billing')) {
    return 'sin_saldo';
  }
  if (m.includes('429') || m.includes('rate limit')) return 'limite';
  if (m.includes('529') || m.includes('overload')) return 'sobrecarga';
  return 'otro';
}

/** Llave del throttle: por DÍA y por causa. Un cambio de causa vuelve a avisar,
 *  porque quedarse sin saldo y que la API esté sobrecargada se arreglan distinto.
 *
 *  🔴 EL DÍA ES EL DE CHILE, NO EL DE UTC [compuerta cruzada · Codex #4].
 *  Con `toISOString()` el día cambiaba a las 21:00 de Santiago: dos avisos con
 *  minutos de diferencia dentro de la misma noche. Y no es un caso de laboratorio
 *  — los cinco episodios medidos empezaron de noche (00:17, 22:44, 01:57, 22:56),
 *  que es justo el borde. El día de la llave tiene que ser el día del dueño. */
export function claveAvisoRespaldo(causa, ahora = new Date()) {
  let dia;
  try {
    // en-CA da AAAA-MM-DD, que es lo que hace falta para una llave ordenable.
    dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(ahora));
  } catch {
    dia = new Date(ahora).toISOString().slice(0, 10);   // entorno sin tz: mejor UTC que romper
  }
  return `aviso_cerebro_respaldo:${causa || 'otro'}:${dia}`;
}

/**
 * El texto que le llega a Marcelo por WhatsApp. Sin jerga: qué pasó, qué significa
 * para el cliente, y qué hacer. El link va SIEMPRE (regla del dueño, 27-ago: "dame
 * el link y qué hacer si necesitas que me conecte a algo").
 */
export function mensajeCerebroRespaldo({ causa, proveedor, ahora = new Date() } = {}) {
  const hora = (() => {
    try {
      return new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short',
      }).format(new Date(ahora));
    } catch { return new Date(ahora).toISOString(); }
  })();

  const cabeza = `🧠 *Oliver está contestando con el cerebro de respaldo* (${proveedor || 'otro proveedor'}) — ${hora}`;
  const cuerpo = {
    sin_saldo: [
      '',
      '*Por qué:* se acabó el saldo de la API de Anthropic.',
      '*Qué significa:* tus clientes siguen siendo atendidos, pero con un modelo distinto',
      'al que está calibrado el prompt (garantías, plazos, perfilamiento).',
      '',
      '*Qué hacer:* recargá y dejá activado el Auto-reload:',
      'https://console.anthropic.com/settings/billing',
    ],
    limite: [
      '',
      '*Por qué:* se alcanzó el límite de velocidad de la API (429), no es falta de saldo.',
      '*Qué hacer:* si se repite en días seguidos, hay que pedir más cuota. Si fue un pico',
      'aislado, se corrige solo.',
    ],
    sobrecarga: [
      '',
      '*Por qué:* la API del proveedor principal está sobrecargada de su lado (529).',
      '*Qué hacer:* nada. El respaldo es justamente para esto y se normaliza solo.',
    ],
    otro: [
      '',
      '*Por qué:* el proveedor principal falló por un motivo que no es saldo ni límite.',
      '*Qué hacer:* avisale a quien lleve el sistema para que mire el log de hoy.',
    ],
  }[causa || 'otro'];

  return [cabeza, ...cuerpo, '', '_Este aviso sale una vez al día. Se apaga con OLIVER_ALERTA_RESPALDO=false._'].join('\n');
}

export default { mensajeCerebroRespaldo, causaDelRespaldo, claveAvisoRespaldo, RESPALDO_REPETIR_MS };
