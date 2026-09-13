FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV DATA_DIR=/app/data

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data && chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/server/server/index.js"]
