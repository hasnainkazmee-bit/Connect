import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  define: { "import.meta.env.VITE_CONNECT_RELEASE": JSON.stringify(process.env.CONNECT_RELEASE || "development") },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:4100", changeOrigin: false } },
  },
});
