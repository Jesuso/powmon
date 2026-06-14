# node:22-slim works because better-sqlite3 ships prebuilt binaries for
# linux x64/arm64 glibc; no toolchain needed. tsx (the production runner per
# `npm start`) is a devDependency, so install everything — no --omit=dev.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3001
# Liveness via the existing /api/health route (200 = API up). Uses node's own
# http client so no curl/wget needed in the slim image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://127.0.0.1:3001/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["npm", "start"]
