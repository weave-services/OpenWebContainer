import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['quickjs-emscripten']
  },
  resolve: {
    alias: {
      // Add this if you need to resolve WASM files
      'quickjs-emscripten-module': 'quickjs-emscripten/dist/quickjs.wasm'
    }
  },
  assetsInclude: ['**/*.wasm']
})

