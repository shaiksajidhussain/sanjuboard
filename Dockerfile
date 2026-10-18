FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY shared shared
COPY server server
COPY client client
COPY vitest.config.ts ./
RUN npm run build -w client

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "run", "start", "-w", "server"]
