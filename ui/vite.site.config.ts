import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// The marketing site: a separate entry (site/index.html) that reuses the app's pals, sprites and riso styles.
// Static output in dist-site/, ready for any host. Nothing here is embedded in Waypoint.exe.

const storeStub = fileURLToPath(new URL("./site/stubs/store.ts", import.meta.url));

/** The app's sprite code reads live audio levels from its store, which talks to Windows; the site feeds its own. */
function stubAppStore(): Plugin {
  return {
    name: "waypoint-site-store-stub",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer && /[\/]src[\/]/.test(importer) && /(^|\/)store\/store$/.test(source)) return storeStub;
      return null;
    },
  };
}

export default defineConfig({
  root: "site",
  base: "./",
  publicDir: "../public",
  plugins: [stubAppStore(), react(), tailwindcss()],
  server: { port: 5176, strictPort: true, fs: { allow: [".."] } },
  build: {
    target: "es2022",
    outDir: "../dist-site",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
