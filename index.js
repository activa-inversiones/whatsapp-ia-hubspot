// ====== Helpers nuevos: extracción + siguiente pregunta + contradicción ======

const CITY_KEYWORDS = [
  "temuco",
  "padre las casas",
  "villarrica",
  "pucon",
  "pucón",
  "lautaro",
  "freire",
  "labranza",
  "carahue",
  "nueva imperial",
  "imperial",
  "angol",
  "victoria",
  "collipulli",
];

function detectCityOrComuna(text = "") {
  const t = normalize(text);
  for (const c of CITY_KEYWORDS) {
    if (t.includes(c)) return c.replace(/\b\w/g, (m) => m.toUpperCase());
  }
  return null;
}

function detectGoal(text = "") {
  const t = normalize(text);
  if (/(aislaci[oó]n t[eé]rmica|fr[ií]o|calor|temperatura|eficiencia energ[eé]tica)/i.test(t)) return "AISLACIÓN_TÉRMICA";
  if (/(ruido|ac[uú]stic|sonido)/i.test(t)) return "AISLACIÓN_ACÚSTICA";
  if (/(condensaci[oó]n|empa[nñ]amiento|hongo|humedad)/i.test(t)) return "CONTROL_CONDENSACIÓN";
  if (/(seguridad|laminad|antirrobo)/i.test(t)) return "SEGURIDAD";
  return null;
}

function parseLeadFromText(lead, text) {
  const t = normalize(text);

  // Tipo cliente (acepta cambios)
  if (/residencial|casa|depto|departamento|hogar/i.test(t)) lead.customerType = "RESIDENCIAL";
  if (/comercial|local|tienda|oficina|bodega|industrial/i.test(t)) lead.customerType = "COMERCIAL";
  if (/constructora|inmobiliaria|obra|licitaci[oó]n/i.test(t)) lead.customerType = "CONSTRUCTOR";
  if (/arquitect|proyectista|especificador/i.test(t)) lead.customerType = "ARQUITECTO";
  if (/colegio|cesfam|hospital|municipal|instituci[oó]n/i.test(t)) lead.customerType = "INSTITUCIONAL";

  // Ciudad/Comuna
  const city = detectCityOrComuna(text);
  if (city) {
    lead.city = city;
    lead.comuna = city;
  }

  // Productos
  const prods = detectProducts(text);
  if (prods.length) {
    lead.products = Array.from(new Set([...(lead.products || []), ...prods]));
  }

  // Material / sistema
  if (/pvc/i.test(t)) lead.notes = mergeNote(lead.notes, "Interés en PVC");
  if (/alumin/i.test(t)) lead.notes = mergeNote(lead.notes, "Interés en aluminio");

  // Vidrio / termopanel
  if (/(termopanel|dvh)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["DVH"]);
  if (/(triple)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["TRIPLE"]);
  if (/(low[-\s]?e|baja emisividad)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["LOW_E"]);
  if (/(laminad)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["LAMINADO"]);
  if (/(argon)/i.test(t)) lead.glazing = mergeTokenList(lead.glazing, ["ARGON"]);

  // Objetivo
  const goal = detectGoal(text);
  if (goal) lead.goal = goal;

  return lead;
}

function mergeNote(current, add) {
  const c = (current || "").trim();
  if (!c) return add;
  if (c.toLowerCase().includes(add.toLowerCase())) return c;
  return `${c} | ${add}`;
}

function mergeTokenList(current, tokens = []) {
  const set = new Set(
    (current || "")
      .split(/[,\|]/)
      .map((x) => x.trim())
      .filter(Boolean)
  );
  tokens.forEach((x) => set.add(x));
  return Array.from(set).join(", ");
}

function pickNextQuestion(lead) {
  // Orden inteligente: evita repetir, pide lo mínimo para cotizar/agenda
  if (!lead.customerType) return { key: "customerType", q: "¿Es para casa (residencial) o para un local/negocio (comercial)?" };
  if (!lead.city && !lead.comuna) return { key: "city", q: "¿En qué comuna/ciudad es el proyecto?" };
  if (!lead.products || lead.products.length === 0) return { key: "products", q: "¿Qué necesitas cotizar: ventanas, puertas, muro cortina o tabiques vidriados?" };
  if (!lead.goal) return { key: "goal", q: "¿Tu prioridad es aislación térmica, acústica o controlar condensación?" };
  if (!lead.quantities && !lead.measures) return { key: "scope", q: "¿Cuántas unidades son y tienes medidas aproximadas? (aunque sea estimado)" };
  if (!lead.timeline) return { key: "timeline", q: "¿Para cuándo lo necesitas? (urgente / 1-2 semanas / 1 mes / más)" };
  return null;
}

function detectContradiction(prevLead, newLead) {
  if (!prevLead?.customerType) return null;
  if (!newLead?.customerType) return null;
  if (prevLead.customerType !== newLead.customerType) {
    return { from: prevLead.customerType, to: newLead.customerType };
  }
  return null;
}

// ====== Prompt mejorado: prohíbe repetir y exige 1 pregunta ======
function buildSystemPrompt({ session }) {
  const lead = session.lead || {};
  return `
Eres un asesor comercial humano de ${BUSINESS_NAME}. Estilo: cercano, breve, directo, sin frases robóticas.
Objetivo: vender y agendar medición/cotización.

REGLAS CRÍTICAS (obligatorias):
1) NO repitas preguntas ya respondidas. Usa el lead como memoria.
2) Máximo 1 pregunta por mensaje (salvo confirmación de contradicción, que también es 1 pregunta).
3) Siempre inicia con un resumen breve de lo entendido (1-2 líneas) + beneficio concreto (1 línea) + pregunta única.
4) Si el cliente cambia “residencial/comercial”, no lo discutas: CONFIRMA una sola vez y luego sigue.
5) Normativa eficiencia energética Chile: habla de “exigencias vigentes de eficiencia energética / desempeño térmico, control de condensación y sellos”, sin citar decretos específicos.
6) Si el usuario pide precio sin datos: ofrece rango “referencial” y pide el dato faltante más importante.

LEAD ACTUAL (memoria):
- Tipo cliente: ${lead.customerType || "N/D"}
- Ciudad/comuna: ${lead.city || lead.comuna || "N/D"}
- Productos: ${(lead.products || []).join(", ") || "N/D"}
- Vidrio: ${lead.glazing || "N/D"}
- Objetivo: ${lead.goal || "N/D"}
- Cantidad/medidas: ${lead.quantities || ""} ${lead.measures || ""}
- Plazo: ${lead.timeline || "N/D"}
`;
}

// ====== generateSalesReply REEMPLAZADO ======
async function generateSalesReply({ waId, userText }) {
  const session = getSession(waId);

  // Copia previa para detectar contradicción
  const prev = { ...session.lead };

  // Actualiza lead con lo que diga el usuario
  session.lead = parseLeadFromText(session.lead, userText);

  const contradiction = detectContradiction(prev, session.lead);

  // Si hay contradicción, confirmar 1 vez y marcar bandera para no insistir
  if (contradiction && !session.profile?.typeConfirmed) {
    session.profile.typeConfirmed = true;
    return `Perfecto, para no equivocarme: me dijiste *${contradiction.from}* y ahora *${contradiction.to}*. ¿Confirmo que es **${contradiction.to.toLowerCase()}**?`;
  }

  const next = pickNextQuestion(session.lead);

  // Si ya está completo lo mínimo, cerrar con CTA humano
  if (!next) {
    return `Gracias. Con lo que me indicas (${(session.lead.products || []).join(", ") || "tu solicitud"} en ${session.lead.city || session.lead.comuna || "tu comuna"}), te puedo armar una propuesta enfocada a eficiencia térmica y buen sellado.
¿Prefieres que coordinemos **medición en terreno** o me envías **medidas/fotos del vano** para cotizar hoy?`;
  }

  // Si no hay IA, fallback inteligente sin repetir
  if (!OPENAI_API_KEY) {
    const summary = [
      session.lead.city ? `En ${session.lead.city},` : null,
      (session.lead.products || []).length ? `por ${session.lead.products.join(", ")}.` : null,
      session.lead.goal ? `Prioridad: ${session.lead.goal.replace("_", " ").toLowerCase()}.` : null,
    ]
      .filter(Boolean)
      .join(" ");

    const benefit =
      session.lead.goal === "AISLACIÓN_TÉRMICA"
        ? "Con PVC + termopanel (DVH) bien sellado se nota mucho la diferencia en confort y consumo."
        : "Te propongo una solución que cumpla desempeño y te quede ordenada para cotización/obra.";

    return `${summary || "Perfecto, ya te entendí."}
${benefit}
${next.q}`;
  }

  // Con IA: le damos contexto + exigimos 1 pregunta
  const messages = [
    { role: "system", content: buildSystemPrompt({ session }) },
    {
      role: "user",
      content: `Mensaje del cliente: "${userText}".
Tu tarea: redacta una respuesta humana siguiendo reglas, SIN repetir preguntas ya respondidas.
La pregunta única que corresponde ahora es sobre: ${next.key}.`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.35,
    max_tokens: 180,
    messages,
  });

  const reply = completion?.choices?.[0]?.message?.content?.trim();
  return reply || `Perfecto. ${next.q}`;
}
