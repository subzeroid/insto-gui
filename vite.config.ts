import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import pkg from './package.json'

// The header shows the application version; package.json is one of the three files
// `scripts/release_version.py` keeps in agreement.
export default defineConfig({
  plugins: [vue()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  clearScreen: false,
  test: {
    environment: 'happy-dom', include: ['src/**/*.test.ts'], setupFiles: ['src/test-setup.ts'],
    // Node 25's native storage globals otherwise shadow happy-dom in workers.
    execArgv: ['--no-experimental-webstorage'],
  },
})
