'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { ArrowDown, Download, ImagePlus, Loader2, MessageSquare, SendHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/* ─────────── 类型 ─────────── */
interface Identity {
  name: string
  color: string
}

interface ChatMessage {
  id: string
  cid: string | null
  name: string
  color: string
  type: 'text' | 'image'
  text: string | null
  size: number | null
  width: number | null
  height: number | null
  createdAt: string
  pending?: boolean
}

/* ─────────── 匿名身份 ─────────── */
const ADJ = ['快乐的', '机智的', '勇敢的', '温柔的', '神秘的', '活泼的', '安静的', '热情的', '可爱的', '淡定的', '认真的', '悠闲的']
const NOUN = ['土豆', '柠檬', '熊猫', '海豚', '松鼠', '月亮', '云朵', '橘子', '刺猬', '水母', '仓鼠', '山竹']
const COLORS = ['#b45309', '#a16207', '#92400e', '#c2410c', '#9a3412', '#7c2d12', '#78716c', '#57534e']

function genIdentity(): Identity {
  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
  return {
    name: `${pick(ADJ)}${pick(NOUN)}${Math.floor(1000 + Math.random() * 9000)}`,
    color: pick(COLORS),
  }
}

/* ─────────── 兼容工具：老系统（iOS 12+ / 鸿蒙3 / 安卓老 WebView）─────────── */
// crypto.randomUUID 在 iOS < 15.4 / 老 Chromium 上不存在，必须降级
function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/* ─────────── 其他工具 ─────────── */
const fmtSize = (n?: number | null) =>
  n == null ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('读取图片失败'))
    r.readAsDataURL(file) // 原始字节 → base64，不做任何压缩（FileReader 全兼容 iOS9+/安卓5+）
  })
}

function getImageDims(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/* ─────────── 页面 ─────────── */
export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [me, setMe] = useState<Identity | null>(null)
  const [cid, setCid] = useState('')
  const [text, setText] = useState('')
  const [online, setOnline] = useState(1)
  const [connected, setConnected] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [dragging, setDragging] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      const el = listRef.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    })
  }, [])

  const mergeMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/messages')
      if (res.ok) setMessages(await res.json())
      scrollToBottom(false)
    } catch {
      // 忽略，等 socket 重连后重试
    }
  }, [scrollToBottom])

  /* ─────────── 初始化：身份 + 历史 + 实时连接 ─────────── */
  useEffect(() => {
    let id: Identity
    const raw = localStorage.getItem('tugu:me')
    if (raw) {
      try {
        id = JSON.parse(raw)
      } catch {
        id = genIdentity()
        localStorage.setItem('tugu:me', JSON.stringify(id))
      }
    } else {
      id = genIdentity()
      localStorage.setItem('tugu:me', JSON.stringify(id))
    }
    setMe(id)

    let c = localStorage.getItem('tugu:cid')
    if (!c) {
      c = uuid()
      localStorage.setItem('tugu:cid', c)
    }
    setCid(c)

    loadHistory()

    // 环境自适应：81=沙箱预览网关 / 其他=部署形态（单进程同源 /socket.io）
    const socket =
      window.location.port === '81'
        ? io('/?XTransformPort=3003')
        : io({ path: '/socket.io', transports: ['websocket', 'polling'] })
    socketRef.current = socket
    socket.on('connect', () => {
      setConnected(true)
      socket.emit('hello', { name: id.name, color: id.color })
      loadHistory() // 断线重连后全量补拉，确保不丢消息
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('presence', (p: { count: number }) => setOnline(p.count))
    socket.on('message', (m: ChatMessage) => {
      mergeMessage(m)
      if (nearBottomRef.current) scrollToBottom()
      else setShowNew(true)
    })

    // 粘贴图片（桌面端；移动端无此事件，不影响）
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (file) {
        e.preventDefault()
        void sendImage(file)
      }
    }
    // 拖拽图片（桌面端；移动端无此事件，不影响）
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        setDragging(true)
      }
    }
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      Array.from(e.dataTransfer?.files ?? []).forEach((f) => {
        if (f.type.startsWith('image/')) void sendImage(f)
      })
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)

    return () => {
      socket.disconnect()
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  /* ─────────── 灯箱 Esc 关闭 ─────────── */
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  /* ─────────── 新消息自动滚底 ─────────── */
  useEffect(() => {
    if (nearBottomRef.current) scrollToBottom(messages.length > 0)
  }, [messages])

  /* ─────────── 输入框自动增高 ─────────── */
  useEffect(() => {
    const ta = taRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
    }
  }, [text])

  /* ─────────── 发送文字 ─────────── */
  const sendText = async () => {
    const t = text.trim()
    if (!t || !me || sendingRef.current) return
    sendingRef.current = true
    setText('')
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid, name: me.name, color: me.color, type: 'text', text: t }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: '发送失败', description: data.error ?? '请稍后重试', variant: 'destructive' })
        setText(t)
        return
      }
      mergeMessage(data)
      scrollToBottom()
    } catch {
      toast({ title: '网络异常', description: '请检查网络后重试', variant: 'destructive' })
      setText(t)
    } finally {
      sendingRef.current = false
    }
  }

  /* ─────────── 发送图片（原图直传，不压缩；全兼容流程） ─────────── */
  const sendImage = async (file: File) => {
    if (!me) return
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: '图片过大', description: '单个图片不能超过 20MB', variant: 'destructive' })
      return
    }
    const src = await readAsDataURL(file)
    const dims = await getImageDims(src)
    const pid = `pending-${uuid()}`
    setMessages((prev) => [
      ...prev,
      {
        id: pid,
        cid,
        name: me.name,
        color: me.color,
        type: 'image',
        text: null,
        size: file.size,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        createdAt: new Date().toISOString(),
        pending: true,
      },
    ])
    scrollToBottom()
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cid,
          name: me.name,
          color: me.color,
          type: 'image',
          src,
          width: dims?.width,
          height: dims?.height,
        }),
      })
      const data = await res.json()
      setMessages((prev) => prev.filter((m) => m.id !== pid))
      if (!res.ok) {
        toast({ title: '图片发送失败', description: data.error ?? '请稍后重试', variant: 'destructive' })
        return
      }
      mergeMessage(data)
      scrollToBottom()
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== pid))
      toast({ title: '网络异常', description: '图片未发出，请重试', variant: 'destructive' })
    }
  }

  /* ─────────── 渲染 ─────────── */
  return (
    // h-screen 兜底 + 内联 100dvh 渐进增强：不认识 dvh 的老系统自动忽略内联值
    <div className="flex h-screen flex-col bg-background text-foreground" style={{ height: '100dvh' }}>
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">图咕</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">免登录 · 原图直发</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              'inline-block size-2 rounded-full',
              connected ? 'bg-primary' : 'animate-pulse bg-zinc-400'
            )}
            aria-hidden
          />
          {online} 人在线
        </div>
      </header>

      {/* 消息区 */}
      <main
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
          if (nearBottomRef.current) setShowNew(false)
        }}
        className="flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      >
        <div className="mx-auto w-full max-w-3xl">
          {messages.length === 0 && (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
              <MessageSquare className="size-8" aria-hidden />
              <span className="text-sm">还没有消息，来打个招呼吧</span>
            </div>
          )}
          {messages.map((m) => {
            const mine = !!m.cid && m.cid === cid
            return (
              <div key={m.id} className={cn('mb-3 flex gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
                {!mine && (
                  <span
                    className="mt-0.5 flex size-8 shrink-0 select-none items-center justify-center rounded-full text-sm font-medium text-white"
                    style={{ backgroundColor: m.color }}
                    aria-hidden
                  >
                    {m.name.slice(0, 1)}
                  </span>
                )}
                <div className={cn('flex max-w-[78%] flex-col gap-1', mine ? 'items-end' : 'items-start')}>
                  {!mine && <span className="px-1 text-xs text-muted-foreground">{m.name}</span>}
                  <div className="flex items-end gap-1.5">
                    <span className="px-1 text-[10px] leading-5 text-muted-foreground">
                      {fmtTime(m.createdAt)}
                    </span>
                    {m.type === 'text' ? (
                      <div
                        className={cn(
                          'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                          mine
                            ? 'rounded-tr-md bg-primary text-primary-foreground'
                            : 'rounded-tl-md bg-muted'
                        )}
                      >
                        {m.text}
                      </div>
                    ) : m.pending ? (
                      <div className="flex h-44 w-56 items-center justify-center rounded-2xl rounded-tr-md border bg-muted">
                        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="发送中" />
                      </div>
                    ) : (
                      <figure className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => setLightbox(`/api/images/${m.id}`)}
                          className="overflow-hidden rounded-2xl rounded-tr-md transition hover:opacity-90"
                          aria-label="查看原图"
                        >
                          <img
                            src={`/api/images/${m.id}`}
                            alt={`${m.name} 发送的图片`}
                            loading="lazy"
                            className="max-h-72 w-auto max-w-full rounded-2xl object-contain"
                          />
                        </button>
                        <figcaption className="px-1 text-[10px] text-muted-foreground">
                          {m.width && m.height ? `${m.width}×${m.height} · ` : ''}
                          {fmtSize(m.size)} · 原图
                        </figcaption>
                      </figure>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </main>

      {/* 新消息提示 */}
      {showNew && (
        <button
          type="button"
          onClick={() => {
            setShowNew(false)
            scrollToBottom()
          }}
          className="absolute bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-4 py-1.5 text-xs text-background shadow-lg transition hover:opacity-90"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          新消息
        </button>
      )}

      {/* 输入区 */}
      <footer className="shrink-0 border-t bg-background px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              Array.from(e.target.files ?? []).forEach((f) => void sendImage(f))
              e.target.value = ''
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
            onClick={() => fileRef.current?.click()}
            aria-label="发送图片"
            title="发送图片"
          >
            <ImagePlus className="size-5" />
          </Button>
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void sendText()
              }
            }}
            placeholder="发消息…（可粘贴 / 拖入图片）"
            className="max-h-30 min-h-10 flex-1 resize-none rounded-xl border border-input bg-muted px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
            aria-label="输入消息"
          />
          <Button
            size="icon"
            className="size-10 shrink-0 rounded-xl bg-foreground text-background hover:opacity-90 disabled:opacity-40"
            onClick={() => void sendText()}
            disabled={!text.trim()}
            aria-label="发送"
          >
            <SendHorizontal className="size-5" />
          </Button>
        </div>
      </footer>

      {/* 拖拽提示遮罩 */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-background">
          <div className="rounded-2xl border-2 border-dashed border-primary px-10 py-8 text-center">
            <ImagePlus className="mx-auto mb-2 size-8 text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">松开鼠标，原图发送</p>
          </div>
        </div>
      )}

      {/* 灯箱：查看 & 下载原图 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-[rgba(0,0,0,0.85)] p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="rounded-lg p-2 text-[#d6d3d1] transition hover:bg-[rgba(255,255,255,0.12)] hover:text-white"
              aria-label="关闭"
            >
              <X className="size-5" />
            </button>
            <a
              href={lightbox}
              download
              className="rounded-lg p-2 text-[#d6d3d1] transition hover:bg-[rgba(255,255,255,0.12)] hover:text-white"
              aria-label="下载原图"
            >
              <Download className="size-5" />
            </a>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <img
              src={lightbox}
              alt="原图预览"
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <p className="pt-3 text-center text-xs text-[#a8a29e]">图片未压缩 · 点击空白处或按 Esc 关闭</p>
        </div>
      )}
    </div>
  )
}
