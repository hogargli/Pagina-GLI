require('dotenv').config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const twilio = require("twilio");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const WHATSAPP_TO = process.env.WHATSAPP_TO;
const API_KEY = process.env.API_KEY;


// === DATOS DEL USUARIO ===
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

// === HISTORIAL DE CONVERSACIÓN ===
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

app.post("/ask-gemini", async (req, res) => {
  const prompt = req.body.prompt?.trim() || "";

  // Guardar mensaje del usuario
  conversationHistory.push({ role: "user", parts: [{ text: prompt }] });

  // === Extracción de datos clave ===
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

  // === Definir saludo dinámico ===
  const hora = new Date().getHours();
  let saludo = "Hola";
  if (hora < 12) saludo = "¡Buenos días!";
  else if (hora < 19) saludo = "¡Buenas tardes!";
  else saludo = "¡Buenas noches!";

  // === Prompt dinámico para Gemini ===
  const contextPrompt = `
Eres un asistente virtual cordial de GLI Inmobiliaria.
Siempre inicia saludando según la hora: "${saludo}".
Responde de manera natural y congruente con lo que el cliente dice.
- Si el cliente menciona interés en comprar/rentar/vender una propiedad, entonces empieza a guiarlo con las siguientes preguntas: ${preguntas.join(" → ")}.
- Si el cliente no menciona propiedades, responde amable y ofrece ayuda sin forzar preguntas.
- Recopila solo lo necesario y nunca repitas lo ya contestado.
Mensaje del cliente: "${prompt}"
Información conocida hasta ahora:
${JSON.stringify(userData, null, 2)}
`;

  const contents = [
    { role: "user", parts: [{ text: contextPrompt }] },
    ...conversationHistory,
  ];

  try {
    const response = await axios.post(
      GEMINI_URL,
      { contents },
      { headers: { "Content-Type": "application/json", "X-goog-api-key": API_KEY } }
    );

    const candidate = response.data?.candidates?.[0];
    const reply = candidate?.content?.parts?.[0]?.text || "No se recibió respuesta válida de Gemini.";

    conversationHistory.push({ role: "model", parts: [{ text: reply }] });

    // === Enviar lead por WhatsApp si hay datos clave ===
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
        body: mensajeWhatsApp,
      });

      // Reiniciar datos y conversación
      userData = {
        nombre: null, zona: null, tipoPropiedad: null, presupuesto: null,
        intencion: null, habitaciones: null, banos: null, jardin: null, extras: null
      };
      conversationHistory = [];
    }

    res.json({ reply });
  } catch (err) {
    console.error("❌ Error consultando Gemini o enviando WhatsApp:", err.response?.data || err.message);
    res.status(500).json({ error: "Error al consultar Gemini o enviar WhatsApp" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en el puerto ${PORT}`));
