FROM oven/bun:debian AS builder

WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build production assets
COPY . .
RUN bun run build

FROM nginx:1.27-alpine AS runtime

WORKDIR /usr/share/nginx/html

# Copy SPA-aware nginx config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy build artifacts
COPY --from=builder /app/dist ./

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

