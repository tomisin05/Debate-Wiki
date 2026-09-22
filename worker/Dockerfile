FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.worker.json ./
COPY src ./src
COPY worker ./worker
RUN npm run worker:build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist-worker ./dist-worker
CMD ["node", "dist-worker/worker/src/server.js"]
