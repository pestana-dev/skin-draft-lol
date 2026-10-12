import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // .env na raiz do monorepo
  envDir: resolve(rootDir, '../..'),
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
})
