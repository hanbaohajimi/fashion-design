import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** 默认用 127.0.0.1，避免 Windows 下 localhost 优先走 IPv6 而本机服务只监听 IPv4 时出现「连接失败」。 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const designTarget = env.VITE_DESIGN_PROXY_TARGET || 'http://127.0.0.1:8001'
  const trendTarget = env.VITE_TREND_PROXY_TARGET || 'http://127.0.0.1:8002'
  const gatewayTarget = env.VITE_GATEWAY_PROXY_TARGET || 'http://127.0.0.1:8000'

  return {
    plugins: [tailwindcss(), react()],
    server: {
      // 避免与常见占用 3000 的其它服务（如部分厂商 hw_server）冲突
      port: Number(env.FASHION_FRONTEND_PORT) || 3100,
      proxy: {
        '/api/design': {
          target: designTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/design/, '/api'),
        },
        '/api/trend': {
          target: trendTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/trend/, '/api'),
        },
        '/api/gateway': { target: gatewayTarget, changeOrigin: true },
        '/ws': { target: trendTarget, changeOrigin: true, ws: true },
      },
    },
  }
})
