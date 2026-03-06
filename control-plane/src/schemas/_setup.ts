/**
 * Extends Zod with .openapi() method.
 * Must be imported before any schema that uses .openapi().
 */
import { extendZodWithOpenApi } from "@hono/zod-openapi";
import { z } from "zod/v4";

extendZodWithOpenApi(z);
