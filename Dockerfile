# Lobster-Tracer 部署镜像
# 适用: Hugging Face Spaces(Docker) / Fly.io / Render(Docker) / Koyeb / 任意容器平台
FROM node:20-slim

# better-sqlite3 是原生模块: 预编译二进制通常直接命中, 这里装构建工具作兜底
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Hugging Face Spaces 固定走 7860 端口: 需在 Space 设置里 app_port: 7860,
#   或注入环境变量 PORT=7860。其余平台用各自注入的 PORT 即可(本镜像默认 3000)。
EXPOSE 3000
ENV PORT=3000

# DEMO_MODE=1: 启动自动灌入 7+ 个示例会话(评委打开即见饱满面板, 无需持久盘)
ENV DEMO_MODE=1
ENV NODE_ENV=production

CMD ["npm", "start"]
