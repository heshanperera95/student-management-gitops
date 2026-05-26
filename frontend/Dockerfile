# Stage 1 — Build Angular app
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json .
RUN npm install

# Copy source and build
COPY . .
RUN npm run build:prod

# Stage 2 — Serve with nginx
FROM nginx:1.27-alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built Angular app
COPY --from=builder /app/dist/student-management/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
