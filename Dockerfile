FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        ca-certificates \
        fonts-liberation \
        fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist

USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
