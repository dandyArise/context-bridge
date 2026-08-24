import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { discoverExternalCatalog, tokenizeExternal } from "../externalApi.js";

const seen = [];
const server = createServer((request, response) => {
  seen.push({ url: request.url, authorization: request.headers.authorization });
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/v1/models") {
    response.end(
      JSON.stringify({ data: [{ id: "smoke-model", context_length: 65536 }] }),
    );
    return;
  }
  if (request.url === "/llm/tokenize") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const payload = JSON.parse(body);
      assert.equal(payload.model, "smoke-model");
      assert.ok(Array.isArray(payload.messages));
      response.end(JSON.stringify({ token_count: 321, context_length: 65536 }));
    });
    return;
  }
  if (request.url === "/v1/model/info") {
    response.end(
      JSON.stringify({
        data: [
          {
            model_name: "smoke-model",
            model_info: {
              max_input_tokens: 65536,
              supports_tool_choice: true,
              supports_vision: false,
            },
          },
        ],
      }),
    );
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const connection = {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "smoke-secret",
  };
  const catalog = await discoverExternalCatalog(connection);
  assert.deepEqual(catalog, {
    models: [
      {
        id: "smoke-model",
        contextLength: 65536,
        capabilities: { supports_tool_choice: true, supports_vision: false },
      },
    ],
    warnings: [],
  });
  const count = await tokenizeExternal(connection, catalog.models[0].id, [
    { role: "user", content: "hello" },
  ]);
  assert.deepEqual(count, { used: 321, contextLength: 65536 });
  assert.equal(seen.length, 3);
  assert.ok(
    seen.every((entry) => entry.authorization === "Bearer smoke-secret"),
  );
  console.info(
    "runtime smoke: ok (models, model info, /llm/tokenize, Bearer header, context metadata)",
  );
} finally {
  server.close();
  await once(server, "close");
}
