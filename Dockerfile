# 图咕聊天室 · 单进程镜像（Next.js + socket.io 同端口）
FROM oven/bun:1.2
WORKDIR /app

# 依赖层（利用缓存）
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# 源码 + 构建（prisma generate → next build → 初始化空数据库）
COPY . .
RUN bunx prisma generate && bun run build && bun run db:push

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
# Render 会注入 PORT 环境变量；本地跑可用 -e PORT=3000
EXPOSE 10000

CMD ["bun", "server.ts"]
