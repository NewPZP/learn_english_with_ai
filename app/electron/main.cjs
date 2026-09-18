/**
 * Electron 主进程
 *
 * 复用 vite build 产出的 dist/ 作为渲染进程静态资源：
 * - dev（electron .）→ 加载 vite dev server，HMR + devCorsProxy 仍生效
 * - prod（打包后）→ loadFile(dist/index.html)
 *
 * CORS 处理：webSecurity:false 放行跨域。
 * 火山 TTS / OpenAI 兼容端点不开跨域，且火山带自定义头（X-Api-Key 等）会触发
 * preflight OPTIONS，仅注入 Access-Control-Allow-Origin 不可靠（上游对 OPTIONS
 * 返回非 2xx 则失败）。webSecurity:false 一行解决所有端点，realAdapters 的
 * response.blob()+FileReader 链路零改动。
 * 安全权衡：渲染进程只加载本地可信 dist/index.html，所有远程调用都是用户自配置的
 * 可信 AI 端点，外部链接由 setWindowOpenHandler 拦截到系统浏览器。
 */
const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

const isDev = !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'LinguaAI',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 可信本地学习应用：放开跨域，渲染进程可直接调用用户配置的 AI 端点。
      // 符合 vite.config.ts 注释「生产桌面壳 ... 无 CORS 限制」意图。
      webSecurity: false,
    },
  })

  if (isDev) {
    void win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // 外部链接交给系统浏览器，不在应用窗口内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
