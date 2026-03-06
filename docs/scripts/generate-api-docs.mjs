import { generateFiles } from "fumadocs-openapi";
import { createOpenAPI } from "fumadocs-openapi/server";

const server = createOpenAPI({
  input: ["./openapi.json"],
});

await generateFiles({
  input: server,
  output: "./content/docs/api",
  // groupBy: "route",
  per: "file",
});

console.log("API docs generated in content/docs/api/");
