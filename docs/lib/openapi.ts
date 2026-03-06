import { createOpenAPI } from "fumadocs-openapi/server";
import { createAPIPage } from "fumadocs-openapi/ui";

export const openapi = createOpenAPI({
  input: ["./openapi.json"],
});

export const APIPage = createAPIPage(openapi);
