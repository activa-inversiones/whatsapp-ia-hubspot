# \# 🏎️ Ferrari 5.1 — WhatsApp IA + Zoho CRM

# 

# Bot de WhatsApp con IA para cotización de ventanas/puertas con integración completa a Zoho CRM.

# 

# \## ✨ Características Ferrari 5.1

# 

# \- \*\*🎭 Perfil Psicológico ("Detective")\*\*: Clasifica automáticamente cada mensaje en 4 perfiles: PRECIO, CALIDAD, TÉCNICO, AFINIDAD

# \- \*\*🦎 Tono Dinámico ("Camaleón")\*\*: Ajusta el tono de respuesta según el perfil detectado

# \- \*\*📋 Leads + Deals Automático\*\*: Crea y actualiza tanto Leads como Tratos (Deals) en Zoho

# \- \*\*📊 Pipeline Automático\*\*: Mueve los Deals por las etapas según el progreso de la conversación

# \- \*\*🚫 Anti-Precio\*\*: Bloquea cualquier intento de dar precios por chat (fuerza PDF)

# \- \*\*🔄 Anti-Repetición\*\*: Pide solo 1 dato a la vez, no repite lo que ya tiene

# \- \*\*📜 Normativa OGUC\*\*: Contexto técnico de normativa chilena (solo cuando aporta valor)

# \- \*\*🎧 Audio STT\*\*: Transcribe audios de WhatsApp con Whisper

# \- \*\*🖼️ Vision\*\*: Extrae datos de imágenes (croquis, etiquetas)

# \- \*\*📄 PDF In/Out\*\*: Lee PDFs entrantes y genera cotizaciones

# 

# \## 📋 Etapas del Pipeline (Zoho Deals)

# 

# | Etapa | Probabilidad | Cuándo |

# |-------|--------------|--------|

# | Diagnóstico y Perfilado | 10% | Inicio de conversación |

# | Siembra de Confianza + Marco Normativo | 20% | Ya tiene algunos datos |

# | Presentación de Propuesta | 40% | PDF enviado |

# | Incubadora de Objeciones | 60% | Post-PDF, negociando |

# | Validación Técnica y Normativa | 75% | Datos completos, pre-visita |

# | Cierre y Negociación | 90% | Visita agendada |

# | Cerrado ganado | 100% | ✅ |

# | Cerrado perdido | 0% | ❌ |

# 

# \## 🚀 Deployment en Railway

# 

# \### 1. Crear proyecto en Railway

# 

# ```bash

# \# Opción A: Desde GitHub (recomendado)

# 1\. Sube estos archivos a un repo GitHub

# 2\. En Railway: New Project → Deploy from GitHub repo

# 3\. Selecciona tu repo

# 

# \# Opción B: Desde CLI

# npm i -g @railway/cli

# railway login

# railway init

# railway up

# ```

# 

# \### 2. Configurar Variables de Entorno

# 

# En Railway → Variables, agrega:

# 

# ```env

# \# OBLIGATORIAS

# WHATSAPP\_TOKEN=...

# PHONE\_NUMBER\_ID=...

# VERIFY\_TOKEN=...

# OPENAI\_API\_KEY=sk-...

# ZOHO\_CLIENT\_ID=...

# ZOHO\_CLIENT\_SECRET=...

# ZOHO\_REFRESH\_TOKEN=...

# ZOHO\_REDIRECT\_URI=https://TU-APP.railway.app/zoho/callback

# ```

# 

# \### 3. Obtener Zoho Refresh Token (primera vez)

# 

# 1\. En Railway, obtén tu URL pública (ej: `https://ferrari5-production.up.railway.app`)

# 2\. Configura `ZOHO\_REDIRECT\_URI` = `https://TU-URL/zoho/callback`

# 3\. Visita: `https://TU-URL/zoho/auth`

# 4\. Autoriza la app en Zoho

# 5\. Copia el `refresh\_token` que aparece

# 6\. Pégalo en Railway como `ZOHO\_REFRESH\_TOKEN`

# 7\. Redeploy

# 

# \### 4. Configurar Webhook en Meta

# 

# 1\. Ve a \[Meta for Developers](https://developers.facebook.com/)

# 2\. Tu App → WhatsApp → Configuration

# 3\. Webhook URL: `https://TU-URL/webhook`

# 4\. Verify Token: el mismo que pusiste en `VERIFY\_TOKEN`

# 5\. Suscríbete a: `messages`

# 

# \## 🧪 Endpoints de Test

# 

# | Endpoint | Descripción |

# |----------|-------------|

# | `GET /` | Status del servidor |

# | `GET /health` | Health check |

# | `GET /zoho/auth` | Iniciar OAuth con Zoho |

# | `GET /zoho/callback` | Callback OAuth (no visitar manual) |

# | `GET /zoho/test` | Verificar conexión Zoho |

# | `GET /zoho/test-deal` | Crear Deal de prueba |

# 

# \## 📁 Estructura de Archivos

# 

# ```

# ferrari5/

# ├── index.js          # Código principal

# ├── package.json      # Dependencias

# ├── .env.example      # Variables de ejemplo

# └── README.md         # Este archivo

# ```

# 

# \## 🔧 Variables Opcionales

# 

# ```env

# \# Modelos IA (defaults)

# AI\_MODEL\_OPENAI=gpt-4o-mini

# AI\_MODEL\_CLASSIFIER=gpt-4o-mini

# AI\_MODEL\_STT=whisper-1

# 

# \# Campos custom en Zoho (si los creaste)

# ZOHO\_LEAD\_PROFILE\_FIELD=Perfil\_Cliente

# ZOHO\_DEAL\_PROFILE\_FIELD=Perfil\_Cliente

# 

# \# Comportamiento

# AUTO\_SEND\_PDF\_WHEN\_READY=true

# TZ=America/Santiago

# ```

# 

# \## 🐛 Troubleshooting

# 

# \### "Zoho no devolvió access\_token"

# \- Verifica que `ZOHO\_REFRESH\_TOKEN` sea correcto

# \- Ve a `/zoho/auth` para obtener uno nuevo

# 

# \### "MANDATORY\_NOT\_FOUND: Account\_Name"

# \- Tu layout de Deals requiere Account\_Name obligatorio

# \- Opción 1: Quita el campo obligatorio en Zoho

# \- Opción 2: Crea una Account por defecto y vincúlala

# 

# \### "duplicate msgId"

# \- Normal, Meta envía webhooks duplicados

# \- El sistema los filtra automáticamente

# 

# \### "META signature fail"

# \- Si no usas `APP\_SECRET`, ignora el warning

# \- Para más seguridad, configura `APP\_SECRET` en Meta y Railway

# 

# \## 📞 Soporte

# 

# WhatsApp IA by Activa Inversiones — Temuco, Chile

# 

# ---

# 

# \*\*Ferrari 5.1\*\* — \*"No vendemos ventanas, vendemos confort."\*

# 

# \## 🧠 Humanización de respuesta (muy importante)

# 

# WhatsApp \*\*Cloud API\*\* no permite activar el indicador real de \*“escribiendo…”\* (los puntitos).

# En Ferrari 5.1 lo simulamos con:

# \- \*\*Marcar como leído\*\* el mensaje entrante

# \- \*\*Delays inteligentes\*\* (según longitud)

# \- \*\*Dividir mensajes largos\*\* en 1–2 partes

# 

# Puedes ajustar esto con variables `HUMAN\_\*` del `.env.example`.



