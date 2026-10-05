# Build: compila o projeto Mastra (gera .mastra/output, um server Hono standalone).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx mastra build

# Runtime: só o necessário pra rodar `mastra start`.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV MASTRA_HOST=0.0.0.0
COPY --from=build /app/.mastra/output ./.mastra/output
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules

EXPOSE 4111
CMD ["npx", "mastra", "start"]
