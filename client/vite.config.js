import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// REPO ADINI KENDİNE GÖRE AYARLA
export default defineConfig({
  base: '/summarizerwebversion/',
  plugins: [react()],
  server: { port: 5173 }
})
