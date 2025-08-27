require('dotenv').config(); // Cargar variables de entorno

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const twilio = require("twilio");

const app = express();

// === MIDDLEWARE ===
app.use(cors()); // Permitir peticiones desde cualquier origen
app.use(express.json()); // Parsear JSON
app.use(express.static("public")); // Servir archivos estáticos si los tienes

// === CONFIGURACIÓN DE API Y TWILIO ===
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const WHATSAPP_TO = process.env.WHATSAPP_TO;
const API_KEY = process.env.API_KEY;

const client = twilio(TWILIO_SID, TWILIO_AUTH_TOKEN);

// === DATOS DEL USUARIO Y CONVERSACIÓN ===
let userData = {
  nombre: null,
  zona: null,
  tipoPropiedad: null,
  presupuesto: null,
  intencion: null,
  habitaciones: null,
  banos: null,
  jardin: null,
  extras: null
};
let conversationHistory = [];

// === BANCO DE PREGUNTAS ===
const preguntas = [
  "Cuéntame, ¿qué tipo de propiedad buscas? (casa, departamento, terreno, etc.)",
  "¡Excelente! 🙌 ¿En qué zona te gustaría que estuviera?",
  "Perfecto 👍 ¿Cuál es tu presupuesto aproximado?",
  "Muy bien 👌 ¿Cuántas habitaciones te gustaría?",
  "¿Y cuántos baños?",
  "Genial ✨ ¿Quieres que tenga jardín u otra característica especial?",
  "Por último, ¿me compartes tu número de teléfono o correo de contacto?"
];

// === ENDPOINT PRINCIPAL ===
app.post("/ask-gemini", async (req, res) => {
  try {
    // 👇 Revisar si viene lead completo desde el frontend
    if (req.body.leadData) {
      const lead = req.body.leadData;

      const mensajeWhatsApp = `
📩 Nuevo lead GLI Inmobiliaria
🏠 Tipo: ${lead.tipo || "No especificado"}
📍 Zona: ${lead.zona || "No especificado"}
💰 Presupuesto: ${lead.presupuesto || "No especificado"}
🛏 Habitaciones: ${lead.habitaciones || "No especificado"}
🚿 Baños: ${lead.banos || "No especificado"}
🌳 Jardín: ${lead.jardin || "No especificado"}
✨ Extras: ${lead.extras || "No especificado"}
📞 Contacto: ${lead.contacto || "No especificado"}
      `;

      await client.messages.create({
        from: TWILIO_WHATSAPP_FROM,
        to: WHATSAPP_TO,
        body: mensajeWhatsApp
      });

      return res.json({ success: true, msg: "Lead enviado a WhatsApp" });
    }

    // 👇 Si no viene leadData, procesamos como conversación (modo Gemini)
    const prompt = req.body.prompt?.trim() || "";
    conversationHistory.push({ role: "user", parts: [{ text: prompt }] });

    // === EXTRAER DATOS DEL USUARIO ===
    if (/me llamo|soy|mi nombre es/i.test(prompt)) {
      const match = prompt.match(/me llamo\s+(\w+)|soy\s+(\w+)|mi nombre es\s+(\w+)/i);
      userData.nombre = match?.[1] || match?.[2] || match?.[3] || userData.nombre;
    }
    if (/zona|villa|colinas|residencial|fracc|hacienda/i.test(prompt)) userData.zona = prompt;
    if (/casa|departamento|terreno/i.test(prompt)) userData.tipoPropiedad = prompt;
    if (/\$\s?\d+|\d{6,}/.test(prompt)) {
      const found = prompt.match(/\d{6,}/);
      userData.presupuesto = found ? parseInt(found[0]) : userData.presupuesto;
    }
    if (/comprar|rentar|vender/i.test(prompt)) userData.intencion = prompt;
    if (/\d+\s*habitaciones/i.test(prompt)) userData.habitaciones = prompt;
    if (/\d+\s*baños?/i.test(prompt)) userData.banos = prompt;
    if (/jardín|cochera|patio|terreno/i.test(prompt)) userData.jardin = prompt;

    // === Saludo dinámico ===
    const hora = new Date().getHours();
    let saludo = hora < 12 ? "¡Buenos días!" : hora < 19 ? "¡Buenas tardes!" : "¡Buenas noches!";

    // === Prompt para Gemini ===
    const contextPrompt = `
Eres un asistente virtual cordial de GLI Inmobiliaria.
Saluda según la hora: "${saludo}".
Guía al cliente con las siguientes preguntas si menciona propiedades: ${preguntas.join(" → ")}.
Mensaje del cliente: "${prompt}"
Datos conocidos: ${JSON.stringify(userData, null, 2)}
    `;

    const contents = [{ role: "user", parts: [{ text: contextPrompt }] }, ...conversationHistory];

    const response = await axios.post(
      GEMINI_URL,
      { contents },
      { headers: { "Content-Type": "application/json", "X-goog-api-key": API_KEY } }
    );

    const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 
                  "No se recibió respuesta válida de Gemini.";
    conversationHistory.push({ role: "model", parts: [{ text: reply }] });

    // === Enviar WhatsApp si ya hay datos suficientes ===
    if (userData.nombre && userData.intencion && userData.zona) {
      const mensajeWhatsApp = `
📩 Nuevo lead GLI Inmobiliaria
👤 Nombre: ${userData.nombre}
📍 Zona: ${userData.zona}
🏠 Tipo de propiedad: ${userData.tipoPropiedad || "No especificado"}
💰 Presupuesto: ${userData.presupuesto ? "$" + userData.presupuesto : "No especificado"}
🎯 Intención: ${userData.intencion}
✅ Contactar al cliente para continuar.
      `;

      await client.messages.create({
        from: TWILIO_WHATSAPP_FROM,
        to: WHATSAPP_TO,
        body: mensajeWhatsApp
      });

      // Reiniciar para no duplicar leads
      userData = { nombre: null, zona: null, tipoPropiedad: null, presupuesto: null, intencion: null, habitaciones: null, banos: null, jardin: null, extras: null };
      conversationHistory = [];
    }

    res.json({ reply });
  } catch (err) {
    console.error("❌ Error en Gemini o WhatsApp:", err.response?.data || err.message);
    res.status(500).json({ error: "Error al procesar petición" });
  }
});


// === PUERTO ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en el puerto ${PORT}`));
