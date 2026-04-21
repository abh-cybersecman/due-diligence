FROM node:20-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

# Copy geist font files to public so @font-face rules can reference them at /fonts/
RUN mkdir -p public/fonts/geist-sans public/fonts/geist-mono && \
    cp node_modules/geist/dist/fonts/geist-sans/*.woff2 public/fonts/geist-sans/ && \
    cp node_modules/geist/dist/fonts/geist-mono/*.woff2 public/fonts/geist-mono/

COPY . .

ARG VITE_BASE_PATH=/due-diligence
ARG VITE_API_URL=http://backend:8000
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html/due-diligence
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
