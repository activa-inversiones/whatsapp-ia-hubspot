FROM node:18-slim

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
