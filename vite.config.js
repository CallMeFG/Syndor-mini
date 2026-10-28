import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Semua request /socket.io dan /api diteruskan ke server Node (port 3001),
// jadi frontend cukup dibuka di http://localhost:5173 tanpa masalah CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
      "/api": "http://localhost:3001",
    },
  },
});
