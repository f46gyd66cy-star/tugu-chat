/**
 * 图咕 · 单进程启动入口（部署形态）
 * 用法：NODE_ENV=production bun server.ts
 * 作用：把 Next.js 与 socket.io 跑在同一个端口里（免费托管层只够开一个服务）
 */
import { createServer } from 'node:http'
import next from 'next'
import { Server } from 'socket.io'
import { setIO } from './src/lib/realtime'

const PORT = Number(process.env.PORT) || 3000
const dev = process.env.NODE_ENV !== 'production'

const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    void handle(req, res)
  })

  // socket.io 挂在同一端口，path 用默认 /socket.io（与 Next.js 路由不冲突）
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: true, methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
  })
  setIO(io)

  /* ── 在线状态（与沙箱版 chat-service 相同逻辑） ── */
  const online = new Map<string, { name: string; color: string }>()
  const broadcastPresence = () => io.emit('presence', { count: online.size })

  io.on('connection', (socket) => {
    socket.on('hello', (data: { name?: string; color?: string }) => {
      online.set(socket.id, {
        name: String(data?.name ?? '匿名').slice(0, 24),
        color: /^#[0-9a-fA-F]{6}$/.test(String(data?.color ?? ''))
          ? String(data.color)
          : '#a16207',
      })
      broadcastPresence()
    })
    socket.on('disconnect', () => {
      online.delete(socket.id)
      broadcastPresence()
    })
  })

  httpServer.listen(PORT, () => {
    console.log(`图咕单进程模式已启动: http://0.0.0.0:${PORT} (${dev ? 'dev' : 'production'})`)
  })
})
