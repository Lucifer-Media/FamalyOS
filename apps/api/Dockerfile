# Family OS — API (NestJS + Prisma)
FROM node:22-bookworm-slim AS base
WORKDIR /app
# poppler-utils — растеризация сканированных PDF в изображения для OCR (pdftoppm), локально, без сети в рантайме.
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates poppler-utils curl && rm -rf /var/lib/apt/lists/*

# Языковые данные Tesseract скачиваются ОДИН РАЗ на этапе сборки образа
# (интернет нужен вам как разработчику/на сервере при `docker build`,
# приложению в рантайме сеть НЕ нужна вообще — конфиденциальные документы
# никогда никуда не отправляются). Источник — официальный репозиторий
# tesseract-ocr/tessdata_fast.
FROM base AS tessdata
WORKDIR /tessdata
RUN curl -fsSL -o rus.traineddata https://github.com/tesseract-ocr/tessdata_fast/raw/main/rus.traineddata \
 && curl -fsSL -o eng.traineddata https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata \
 && curl -fsSL -o osd.traineddata https://github.com/tesseract-ocr/tessdata_fast/raw/main/osd.traineddata

FROM base AS deps
COPY package.json ./
COPY prisma ./prisma
RUN npm install --no-audit --no-fund
RUN npx prisma generate

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV TESSDATA_PREFIX=/app/tessdata
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=tessdata /tessdata ./tessdata
COPY package.json ./

# Файловое хранилище (см. FILE_STORAGE_ROOT) — постоянный volume монтируется сюда снаружи.
RUN mkdir -p /app/uploads
VOLUME ["/app/uploads"]

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health',res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
