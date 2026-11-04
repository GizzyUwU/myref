FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN bun install --frozen-lockfile

COPY backend/ ./backend/
COPY frontend/ ./frontend/
RUN bun run --cwd frontend build

WORKDIR /app/backend

EXPOSE 3000

CMD ["sh", "-c", "bun run db:push && bun src/index.ts"]
