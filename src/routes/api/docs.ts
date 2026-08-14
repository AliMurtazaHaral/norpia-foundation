import { createFileRoute } from "@tanstack/react-router";

/** Interactive API reference rendered from /api/v1/openapi.json. */
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>NORPIA — API Reference</title>
  </head>
  <body>
    <script id="api-reference" data-url="/api/v1/openapi.json"></script>
    <script>
      var configuration = { theme: "deepSpace" };
      document.getElementById("api-reference").dataset.configuration = JSON.stringify(configuration);
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

export const Route = createFileRoute("/api/docs")({
  server: {
    handlers: {
      GET: async () =>
        new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
    },
  },
});
