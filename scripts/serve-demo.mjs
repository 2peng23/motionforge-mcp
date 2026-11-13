import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../examples/demo/", import.meta.url));
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const relative = pathname.replace(/^\//, "");
    const target = path.resolve(
      root,
      relative.endsWith("/")
        ? relative + "index.html"
        : relative || "index.html",
    );
    if (!target.startsWith(root)) throw new Error();
    response.setHeader("Content-Type", "text/html");
    response.end(await readFile(target));
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
});
server.listen(Number(process.env.PORT ?? 4174), "127.0.0.1", () =>
  console.error("Demo at http://127.0.0.1:4174"),
);
process.once("SIGTERM", () => server.close());
