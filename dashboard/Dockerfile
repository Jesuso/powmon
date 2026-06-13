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
CMD ["npm", "start"]
