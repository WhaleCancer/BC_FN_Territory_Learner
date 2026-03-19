import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Build for project pages while keeping local dev at root.
  base: command === 'build' ? '/BC_FN_Territory_Learner/' : '/',
}))
