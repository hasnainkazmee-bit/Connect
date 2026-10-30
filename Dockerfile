FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
ARG CONNECT_RELEASE=development
ENV CONNECT_RELEASE=$CONNECT_RELEASE
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ARG CONNECT_RELEASE=local
ENV NODE_ENV=production
ENV CONNECT_RELEASE=$CONNECT_RELEASE
LABEL org.opencontainers.image.revision=$CONNECT_RELEASE
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/migrations apps/api/migrations
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 4100
CMD ["sh", "-c", "node apps/api/dist/migrate.js && node apps/api/dist/server.js"]
