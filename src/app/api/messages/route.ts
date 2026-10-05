import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getIO } from '@/lib/realtime'

const MAX_TEXT = 2000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 20MB
const KEEP_MESSAGES = 300
const CHAT_SERVICE = 'http://127.0.0.1:3004'
const INTERNAL_KEY = 'tugu-internal-7f3k'

export interface MessageMeta {
  id: string
  cid: string | null
  name: string
  color: string
  type: string
  text: string | null
  mime: string | null
  size: number | null
  width: number | null
  height: number | null
  createdAt: string
}

const metaSelect = {
  id: true,
  cid: true,
  name: true,
  color: true,
  type: true,
  text: true,
  mime: true,
  size: true,
  width: true,
  height: true,
  createdAt: true,
}

const IMAGE_MIME = /^data:(image\/(?:png|jpeg|gif|webp|bmp|avif));base64,(.+)$/

async function broadcast(meta: MessageMeta) {
  // 单进程模式：直接进程内广播（无 HTTP 开销）
  const io = getIO()
  if (io) {
    io.emit('message', meta)
    return
  }
  // 沙箱开发模式：独立 chat 服务（3004）
  try {
    await fetch(`${CHAT_SERVICE}/broadcast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY },
      body: JSON.stringify(meta),
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // Socket 服务暂时不可达时忽略——客户端重连后会全量补拉
  }
}

export async function GET() {
  const rows = await db.message.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: metaSelect,
  })
  return NextResponse.json(rows.reverse())
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const name = String(body.name ?? '').slice(0, 24).trim() || '匿名'
  const cid = String(body.cid ?? '').slice(0, 64) || null
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color ?? ''))
    ? String(body.color)
    : '#a16207'
  const type = body.type === 'image' ? 'image' : 'text'

  try {
    if (type === 'text') {
      const text = String(body.text ?? '').trim().slice(0, MAX_TEXT)
      if (!text) return NextResponse.json({ error: '消息不能为空' }, { status: 400 })

      const msg = await db.message.create({
        data: { cid, name, color, type, text },
        select: metaSelect,
      })
      const meta = { ...msg, createdAt: msg.createdAt.toISOString() }
      await trimOld()
      await broadcast(meta)
      return NextResponse.json(meta)
    }

    // 图片：仅接受 dataURL，原图字节直存（无压缩）
    const m = IMAGE_MIME.exec(String(body.src ?? ''))
    if (!m) return NextResponse.json({ error: '仅支持 PNG/JPG/GIF/WebP/BMP/AVIF 图片' }, { status: 400 })

    const buf = Buffer.from(m[2], 'base64')
    if (buf.length === 0) return NextResponse.json({ error: '图片数据为空' }, { status: 400 })
    if (buf.length > MAX_IMAGE_BYTES)
      return NextResponse.json({ error: '图片超过 20MB 上限' }, { status: 413 })

    const msg = await db.message.create({
      data: {
        cid,
        name,
        color,
        type,
        mime: m[1],
        size: buf.length,
        width: Number(body.width) > 0 ? Math.round(Number(body.width)) : null,
        height: Number(body.height) > 0 ? Math.round(Number(body.height)) : null,
        data: buf,
      },
      select: metaSelect,
    })
    const meta = { ...msg, createdAt: msg.createdAt.toISOString() }
    await trimOld()
    await broadcast(meta)
    return NextResponse.json(meta)
  } catch (e) {
    console.error('post message error', e)
    return NextResponse.json({ error: '服务器开小差了，请重试' }, { status: 500 })
  }
}

// 只保留最近 KEEP_MESSAGES 条消息，防止 SQLite 无限膨胀
async function trimOld() {
  try {
    const total = await db.message.count()
    if (total <= KEEP_MESSAGES) return
    const oldest = await db.message.findMany({
      orderBy: { createdAt: 'asc' },
      take: total - KEEP_MESSAGES,
      select: { id: true },
    })
    await db.message.deleteMany({ where: { id: { in: oldest.map((o) => o.id) } } })
  } catch {
    // 清理失败不影响主流程
  }
}
