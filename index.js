import express from "express";

const app = express();

// Railway / proxies: evita problemas de IP / headers
app.set("trust proxy", 1);

// Parse JSON
app.use(express.json({ limit: "2mb" }));

// ✅ Healthcheck: Railway necesita 200 OK
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

// ✅ Webhook Meta (verificación)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Cambia esto por tu VERIFY_TOKEN real (ideal: variable de entorno)
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "CAMBIA_ESTE_TOKEN";

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ✅ Webhook Meta (eventos)
app.post("/webhook", (req, res) => {
  // Importante: responder rápido 200 para que Meta no reintente
  try {
    // Aquí procesas el evento
    // console.log(JSON.stringify(req.body, null, 2));
    return res.sendStatus(200);
  } catch (e) {
    return res.sendStatus(200);
  }
});

// ✅ Escuchar en el puerto que Railway entrega
const PORT = Number(process.env.PORT || 8080);
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor iniciado en puerto: ${PORT}`);
});

// ✅ Cierre limpio: evita “npm error signal SIGTERM” como si fuera error
process.on("SIGTERM", () => {
  console.log("SIGTERM recibido. Cerrando servidor...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000);
});
process.on("SIGINT", () => {
  console.log("SIGINT recibido. Cerrando servidor...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000);
});
