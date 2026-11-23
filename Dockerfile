# Debian 13：Pikafish 的 Linux 版需要 GLIBC 2.38 以上
FROM node:24-trixie-slim
# 录制视频需要 Chromium 和 ffmpeg；中文字体给录制兜底，表情字体用于头像；tzdata 让「每天」按北京时间切
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-cjk fonts-noto-color-emoji tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV HOST=0.0.0.0 PORT=3200 NODE_ENV=production ARENA_CHROME=/usr/bin/chromium TZ=Asia/Shanghai
EXPOSE 3200
VOLUME ["/app/data", "/app/engines"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.js"]
