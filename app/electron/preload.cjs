/**
 * 预加载脚本
 * 暂为空：webSecurity:false 让渲染进程直连用户配置的 AI 端点，无需 IPC 桥。
 *
 * 未来硬化方向（对应 vite.config.ts 注释「主进程发起请求」原意）：
 * - 经 contextBridge 暴露 linguaFetch(url, init)
 * - 主进程发起请求，返回 { ok, status, statusText, headers, bodyBase64 }
 * - 渲染侧重建伪 Response（含 .blob()/.text()/.json()），blobToDataUri 无需变
 * - 经 realAdapters 既有的 options.fetch 依赖注入缝注入
 */
// contextIsolation + sandbox 下空预加载即可
