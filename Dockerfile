# 🔴 [23-sep] ACÁ SE DECIDE QUÉ NODE CORRE EL BOT — no en package.json ni en .nvmrc.
# Este repo se construye con Dockerfile, así que la imagen base MANDA y `engines` se ignora.
# MEDIDO en el build de Railway después de pinear engines a "22.x":
#     npm warn EBADENGINE required: { node: '22.x' }, current: { node: 'v18.20.8' }
# O sea: el pin de package.json no movió nada, solo agregó una advertencia. Node 18 dejó de recibir
# parches de seguridad en abril de 2025 — 17 meses. La variante de Debian se fija explícita
# (bookworm) para no cambiar dos cosas a la vez: lo único que cambia es la versión de Node.
# ffmpeg (para las notas de voz) está en bookworm main, igual que en la imagen anterior.
FROM node:22-bookworm-slim

# Instalar ffmpeg para conversión de audio MP3→OGG Opus (notas de voz WhatsApp)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package files e instalar dependencias
COPY package*.json ./
RUN npm ci --only=production

# Copiar código
COPY . .

# Puerto
EXPOSE 8080

# Iniciar
CMD ["node", "index.js"]
