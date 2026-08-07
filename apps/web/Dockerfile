# Family OS — Web (Next.js)
FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN npm install --no-audit --no-fund

FROM deps AS build
ARG NEXT_PUBLIC_API_URL=http://api:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY package.json ./

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/login',res=>process.exit(res.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "run", "start"]
