# Debian 13：Pikafish 的 Linux 版需要 GLIBC 2.38 以上
FROM node:24-trixie-slim
# 录制视频需要 Chromium 和 ffmpeg；表情字体用于头像
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV HOST=0.0.0.0 PORT=3200 NODE_ENV=production ARENA_CHROME=/usr/bin/chromium
EXPOSE 3200
VOLUME ["/app/data", "/app/engines"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.js"]
