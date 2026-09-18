/**
 * 一次性生成 Mac 图标：从 public/favicon.svg 转换为 1024×1024 不透明 PNG。
 * electron-builder 在 build/ 目录找 icon.png 作为 mac 图标源。
 * 用法：npm run icon
 */
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const svgPath = resolve(__dirname, '../public/favicon.svg')
const outPath = resolve(__dirname, '../build/icon.png')

const svg = readFileSync(svgPath)
// density 提升小尺寸源（48×46）的栅格化质量；fit:contain 居中并铺白底
// （electron-builder 偏好不透明图标）
await sharp(svg, { density: 384 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .png()
  .toFile(outPath)

console.log('wrote', outPath)
