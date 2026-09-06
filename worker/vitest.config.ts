import { defineConfig } from 'vitest/config'

// parsers.ts 是纯函数（无 DOM 依赖），用 node 环境即可。
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
})
