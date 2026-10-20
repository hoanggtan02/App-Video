import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site at https://<user>.github.io/<repo>/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "/App-Video/",
});
