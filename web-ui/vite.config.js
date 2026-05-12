import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'


// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    allowedHosts: ['localhost', '127.0.0.1', '0.0.0.0'],
    proxy: {
      "/api": {
        target: "https://localhost:8443",
        changeOrigin: true,
        secure: true,
      },
    },

  },
  build: {
    outDir: 'tls-manager',
    emptyOutDir: true,
  },
})
