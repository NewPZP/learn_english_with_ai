import { describe, test, expect, afterEach, vi } from 'vitest'
import { proxied } from './devProxy'

/**
 * 开发代理 URL 重写验收测试
 * vitest 默认 MODE='test' → 原样返回；用 vi.stubEnv 模拟 dev 模式验证重写
 */

describe('proxied 开发代理重写', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('测试模式（MODE=test）不重写，URL 原样返回', () => {
    expect(proxied('https://ark.cn-beijing.volces.com/api/v3/models')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/models',
    )
  })

  test('dev 模式下外部 URL 重写为同源代理路径', () => {
    vi.stubEnv('MODE', 'development')
    vi.stubEnv('DEV', true)

    expect(proxied('https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions')).toBe(
      '/dev-proxy/https%3A%2F%2Fark.cn-beijing.volces.com/api/coding/v3/chat/completions',
    )
  })

  test('dev 模式下保留 query 参数', () => {
    vi.stubEnv('MODE', 'development')
    vi.stubEnv('DEV', true)

    expect(proxied('https://api.example.com/v1/models?limit=10')).toBe(
      '/dev-proxy/https%3A%2F%2Fapi.example.com/v1/models?limit=10',
    )
  })

  test('dev 模式下同源相对路径原样返回（已经是同源无需代理）', () => {
    vi.stubEnv('MODE', 'development')
    vi.stubEnv('DEV', true)

    expect(proxied('/dev-proxy/https%3A%2F%2Fapi.example.com/v1/models')).toBe(
      '/dev-proxy/https%3A%2F%2Fapi.example.com/v1/models',
    )
  })

  test('非法 URL 原样返回（不抛错）', () => {
    vi.stubEnv('MODE', 'development')
    vi.stubEnv('DEV', true)

    expect(proxied('not a url')).toBe('not a url')
  })
})
