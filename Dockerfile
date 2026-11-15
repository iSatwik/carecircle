# CareCircle – production image for Google Cloud Run
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
# Run as the unprivileged "node" user that ships with the image.
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
