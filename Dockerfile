FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
RUN node scripts/patch-rustplus-proto.js

COPY server.js tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY server.js ./
COPY public ./public

RUN mkdir /app/data && chown node:node /app/data

USER node
EXPOSE 3010

CMD ["node", "server.js"]
