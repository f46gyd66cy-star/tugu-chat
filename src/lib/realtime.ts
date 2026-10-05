import type { Server } from 'socket.io'

// 单进程模式：server.ts 创建 io 后挂到全局，API 路由直接进程内广播
export function getIO(): Server | null {
  return ((globalThis as Record<string, unknown>).__tuguIO as Server) ?? null
}

export function setIO(io: Server) {
  ;(globalThis as Record<string, unknown>).__tuguIO = io
}
