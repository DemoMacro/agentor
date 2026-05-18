import { defineBuildConfig } from "@funish/basis/config";

export default defineBuildConfig({
  entries: [
    {
      entry: ["src/index.ts", "src/handlers/**/*"],
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
  ],
});
