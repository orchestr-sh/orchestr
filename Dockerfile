# ---- Test stage (lint and tests run in this image) ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY tsconfig.json ./
COPY vitest.config.ts ./
COPY eslint.config.mjs ./
COPY src ./src
COPY tests ./tests
