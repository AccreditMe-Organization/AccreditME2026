FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build -- --configuration production

# ---- Production image (Nginx) ----
FROM nginx:alpine AS production

COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

# Nginx config for Angular HTML5 routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
