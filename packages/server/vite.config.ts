import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/handlers/**/*"],
    minify: true,
    plugins: [
      {
        name: "ignore-node-modules",
        resolveId(id) {
          if (id.includes("node_modules")) {
            return { id, external: true };
          }
        },
      },
    ],
  },
});
