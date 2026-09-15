# Multi-stage build for Node.js frontend
# Stage 1: Builder - compile frontend assets
FROM node:22-alpine AS builder

WORKDIR /app

# Build args for configuration
ARG VITE_API_URL=/api/v1
ARG VITE_GOOGLE_CLIENT_ID=""

ENV VITE_API_URL=$VITE_API_URL \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# Copy package manifests
COPY package*.json ./

# Install ALL dependencies (including devDependencies like vite and tsc)
RUN npm ci --include=dev

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Runtime - nginx serving static SPA files
FROM nginx:1.27-alpine

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built application from builder
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:80/index.html || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
