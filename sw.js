// LULL の Service Worker。設計の意図は docs/06-pwa.md に書いてある。
//
// 手書きなのは、やることが「殻をキャッシュする」「オフラインでも殻を返す」の
// 2つしか無いから。ビルド生成物は Vite が内容ハッシュ付きの名前で出すので、
// プリキャッシュ・マニフェストの仕組みは要らない。
//
// 更新するとき：資産の入れ替えは自動（/assets/ の名前が変わる）。
// 古いキャッシュを一掃したいときだけ VERSION を上げる。

const VERSION = 'v1'
const CACHE = `lull-shell-${VERSION}`

// 配置先の基準パス。GitHub Pages のようにサブパス配下へ置かれても動くよう、
// 絶対パスを書かず自分の scope から導く（`/` でも `/lull-preview/` でも同じ式）
const BASE = new URL(self.registration.scope).pathname

// 起動に最低限必要なものだけ。ハッシュ付きの JS/CSS は初回アクセス時に拾う
const SHELL = [BASE, `${BASE}index.html`, `${BASE}manifest.webmanifest`, `${BASE}icons/icon-192.png`]

// 内容ハッシュが付いている、または不変とみなせるパス。ここだけ cache-first にする。
// それ以外（将来の同一オリジン API など）には一切触らない
const isStatic = (path) =>
  path.startsWith(`${BASE}assets/`) ||
  path.startsWith(`${BASE}icons/`) ||
  path === `${BASE}manifest.webmanifest`

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // HTTP キャッシュ越しの古い index.html を掴まないように reload で取る
      await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => n.startsWith('lull-shell-') && n !== CACHE).map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // SPA なので、どの URL で開かれても返すのは同じ殻。
  // 新しいデプロイをすぐ拾えるようネットワーク優先、落ちたら殻にフォールバック
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req))
    return
  }

  if (isStatic(url.pathname)) e.respondWith(cacheFirst(req))
})

async function networkFirst(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    // オフライン用の殻を最新に保つ。リダイレクト応答は cache.put が受け付けない
    if (res.ok && !res.redirected) cache.put(`${BASE}index.html`, res.clone())
    return res
  } catch {
    const shell = (await cache.match(`${BASE}index.html`)) || (await cache.match(BASE))
    return shell || Response.error()
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok && res.type === 'basic') cache.put(req, res.clone())
  return res
}
