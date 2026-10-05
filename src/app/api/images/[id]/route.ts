import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// 原图直出：从数据库取回原始字节，按原 MIME 返回，不做任何转码
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const msg = await db.message.findUnique({
    where: { id },
    select: { type: true, mime: true, data: true },
  })
  if (!msg || msg.type !== 'image' || !msg.data) {
    return NextResponse.json({ error: '图片不存在' }, { status: 404 })
  }
  const bytes = new Uint8Array(msg.data)
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': msg.mime ?? 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
