/**
 * 开发期 CORS 代理的 URL 重写（前端侧）
 *
 * 背景：浏览器从 localhost 直连外部 AI 端点（如火山方舟 / OpenAI）会被 CORS 拦截
 * （服务端不返回 Access-Control-Allow-Origin，preflight 失败 → Failed to fetch）。
 *
 * 方案：开发模式下把外部 URL 重写为同源代理路径 /dev-proxy/<origin>/<path>，
 * 由 vite.config.ts 中的 devCorsProxy 中间件在服务端转发（服务端无 CORS 限制）。
 * 生产 build（DEV=false）与测试（MODE=test）不重写，URL 原样返回。
 */

/** devCorsProxy 中间件的挂载前缀（与 vite.config.ts 保持一致） */
export const DEV_PROXY_PREFIX = '/dev-proxy'

/**
 * 重写外部 URL 为开发代理路径。
 * 仅在 vite dev 服务器（DEV 且非 test 模式）生效；其余环境原样返回。
 * 相对路径（已是同源）原样返回。
 */
export function proxied(url: string): string {
  if (import.meta.env.MODE === 'test' || !import.meta.env.DEV) return url
  try {
    const parsed = new URL(url)
    if (parsed.origin === window.location.origin) return url
    return `${DEV_PROXY_PREFIX}/${encodeURIComponent(parsed.origin)}${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

/**
 * 生成随机请求 ID（火山 TTS 的 X-Api-Request-Id）。
 * crypto.randomUUID 在部分环境（jsdom 测试环境）不可用，降级为时间戳 + 随机数。
 */
export function randomRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
