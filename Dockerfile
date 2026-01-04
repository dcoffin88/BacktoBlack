# Build the client
FROM node:20 AS client-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Build the server
FROM node:20 AS server-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm install -g typescript
RUN tsc --project server/tsconfig.json
RUN npm run db:init

# Production image
FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache nginx
COPY --from=client-builder /app/dist /app/dist
COPY nginx.conf /etc/nginx/nginx.conf

# Copy server files
COPY --from=server-builder /app/dist /app/dist
COPY --from=server-builder /app/package.json /app/package.json
COPY --from=server-builder /app/package-lock.json /app/package-lock.json
RUN npm ci --omit=dev

EXPOSE 80
EXPOSE 3001

CMD sh -c "nginx -g 'daemon off;' & node dist/server/server.js"
