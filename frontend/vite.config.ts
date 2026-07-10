import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The deployed Edge Function's ALLOWED_ORIGIN is pinned to
  // http://localhost:5173 — strictPort stops Vite from silently hopping to
  // 5174 (which would break CORS) when 5173 is busy.
  server: { port: 5173, strictPort: true },
});
