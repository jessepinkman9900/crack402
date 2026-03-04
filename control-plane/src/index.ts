import { DurableObject } from "cloudflare:workers";

export class MyDurableObject extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const method = request.method;

		if (url.pathname === "/hello" && method === "GET") {
			return Response.json({ message: "Hello, World!" });
		}

		if (url.pathname.startsWith("/hello/") && method === "GET") {
			const name = url.pathname.split("/").at(-1);
			return Response.json({ message: `Hello, ${name}!` });
		}

		return Response.json({ error: "Not Found" }, { status: 404 });
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const id = env.MY_DURABLE_OBJECT.idFromName("default");
		const stub = env.MY_DURABLE_OBJECT.get(id);
		return stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;
