FROM node:20-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=server-build /app/server/package*.json ./
RUN npm install --omit=dev
COPY --from=server-build /app/server/dist ./dist
COPY --from=web-build /app/web/dist ./web/dist

ENV NODE_ENV=production
ENV PORT=3015
ENV VAULT_DIR=/app/vault
ENV DATA_DIR=/app/data
EXPOSE 3015
CMD ["node", "dist/index.js"]
