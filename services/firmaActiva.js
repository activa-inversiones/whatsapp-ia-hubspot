// services/firmaActiva.js — [2026-09-25]
//
// QUIEN FIRMA. Modulo de DATOS PUROS: cero imports, cero dependencias, cero red.
//
// POR QUE EXISTE Y POR QUE ESTA SOLO: reclamo del dueno (25-sep), textual: *"los documentos
// no tienen el mismo formato, deben quedar estandar"*. Tenia razon y la causa estaba medida:
// sus datos vivian COPIADOS en dos lados con redacciones distintas.
//   · services/informeTermico.js  -> 'Ing. Marcelo Cifuentes Mendez', cargo SIN resolucion
//   · services/pieDocumentoPdf.js -> 'Marcelo Cifuentes Mendez', cargo CON '· Res. 266/2025'
// Resultado: los dos informes salian con otro nombre y sin el numero de resolucion, y la
// propuesta si lo mostraba. Es el mismo defecto por el que antes se colo "Calificador" en la
// propuesta mientras los informes ya decian "Evaluador".
//
// POR QUE NO VIVE DENTRO DEL PIE: `informeTermico.js` es un modulo PURO ("se testea sin red")
// y el pie arrastra pdfkit, fs y qrcode-generator. Un dato compartido no puede obligar a
// importar un dibujante de PDF.

export const FIRMA_ACTIVA = {
  nombre: 'Marcelo Cifuentes Méndez',

  // La redaccion la tenia razonada informeTermico.js y se conserva entera: "Evaluador
  // Energetico Externo ACREDITADO POR el MINVU" != "consultor DEL MINVU". Lo segundo
  // insinuaria que trabaja PARA el ministerio, que es otra cosa y expone al cliente si lo
  // repite mal. Acreditado POR el MINVU es ademas mas fuerte: trae numero de resolucion que
  // el cliente puede ir a buscar.
  // Para TEXTO CORRIDO (el mensaje de WhatsApp: "Se lo preparo *Ing. Marcelo...*"). Ahi el
  // tratamiento suena natural; en un bloque de firma, donde la linea de abajo ya dice
  // "Ingeniero Civil Industrial", es redundante. Son registros distintos, no una incoherencia.
  nombreProsa: 'Ing. Marcelo Cifuentes Méndez',

  // SIN la resolucion: el mensaje de WhatsApp ya la agrega aparte entre parentesis, y
  // meterla aca la imprimia DOS VECES en la misma frase.
  cargo: 'Evaluador Energético Externo acreditado MINVU',

  // La que usa el PDF pegada al cargo. "Diario Oficial" no entra: la linea mide 278 pt y la
  // columna tiene 265 (medido con pdfkit).
  resolucionCorta: 'Res. 266/2025',

  // "Diario Oficial" NO entra en la linea del cargo del PDF: mide 278 pt y la columna tiene
  // 265 (medido con pdfkit). Se conserva aca porque el mensaje de WhatsApp del informe si lo
  // usa, y ahi no hay limite de ancho.
  resolucion: 'Res. 266/2025, Diario Oficial',

  titulos: [
    'Ingeniero Civil Industrial · Constructor Civil · Ingeniero Electrónico',
    'MBA Magíster en Administración y Negocios · Magíster en Negocios',
  ],
  rol: 'Gerente de Ingeniería',

  // Contacto. Cada dato con su enlace para que el cliente PINCHE en vez de copiar a mano
  // (pedido del dueno 25-sep: *"si quiero pinchar whatsapp, telefono, link de la empresa"*).
  telefono: '+56 9 5729 6035',
  telefonoUrl: 'tel:+56957296035',
  whatsappUrl: 'https://wa.me/56957296035',
  correo: 'mcifuentes@activaspa.cl',
  correoUrl: 'mailto:mcifuentes@activaspa.cl',
  web: 'activaspa.cl',
  webUrl: 'https://activaspa.cl',
};
