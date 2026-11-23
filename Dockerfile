FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV HOST=0.0.0.0 PORT=3200 NODE_ENV=production
EXPOSE 3200
VOLUME ["/app/data", "/app/engines"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.js"]
