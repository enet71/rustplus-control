FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public
COPY scripts ./scripts

RUN mkdir /app/data && chown node:node /app/data

USER node
EXPOSE 3010

CMD ["npm", "start"]
