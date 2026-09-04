/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * 开发期 CORS 代理：/dev-proxy/<encodeURIComponent(origin)>/<path> → <origin>/<path>
 *
 * 背景：浏览器直连外部 AI 端点会被 CORS 拦截（如火山方舟 / OpenAI 均不开放跨域）。
 * 前端在 dev 模式把请求重写为同源的 /dev-proxy/...（见 src/lib/ai/devProxy.ts），
 * 本中间件在 Node 侧转发到真实端点并原样回传响应（含音频二进制）。
 * 生产桌面壳由 Electron 主进程发起请求，无 CORS 限制，不经过本代理。
 */
function devCorsProxy(): Plugin {
  return {
    name: 'dev-cors-proxy',
    configureServer(server) {
      server.middlewares.use('/dev-proxy', (req, res) => {
        // 中间件挂载后 req.url 已去掉 /dev-proxy 前缀：/<encoded-origin>/<path>
        const match = (req.url ?? '').match(/^\/([^/]+)(\/.*)$/)
        if (!match) {
          res.statusCode = 400
          res.end('dev-proxy: malformed path, expect /dev-proxy/<encoded-origin>/<path>')
          return
        }
        const target = `${decodeURIComponent(match[1])}${match[2]}`

        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('error', () => {
          if (!res.headersSent) {
            res.statusCode = 500
            res.end('dev-proxy: request stream error')
          }
        })
        req.on('end', () => {
          void (async () => {
            try {
              // 转发原始头，去掉 host/origin 等与上游无关或引起冲突的头
              const hopHeaders = new Set([
                'host',
                'origin',
                'referer',
                'cookie',
                'connection',
                'content-length',
                'accept-encoding',
                'keep-alive',
              ])
              const headers: Record<string, string> = {}
              for (const [key, value] of Object.entries(req.headers)) {
                if (typeof value !== 'string') continue
                if (hopHeaders.has(key)) continue
                headers[key] = value
              }
              const hasBody = chunks.length > 0 && req.method !== 'GET' && req.method !== 'HEAD'
              const response = await fetch(target, {
                method: req.method,
                headers,
                body: hasBody ? Buffer.concat(chunks) : undefined,
              })
              res.statusCode = response.status
              response.headers.forEach((value, key) => {
                if (key === 'content-encoding' || key === 'content-length' || key === 'transfer-encoding')
                  return
                res.setHeader(key, value)
              })
              res.end(Buffer.from(await response.arrayBuffer()))
            } catch (err) {
              res.statusCode = 502
              res.end(`dev-proxy: ${err instanceof Error ? err.message : 'upstream request failed'}`)
            }
          })()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devCorsProxy()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
