# Multi-stage build untuk ukuran image lebih kecil
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine

# Install dumb-init untuk proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy dari builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Health check (optional - sesuaikan dengan kebutuhan)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

# Gunakan dumb-init untuk proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start aplikasi
CMD ["node", "dist/index.js"]