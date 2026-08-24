import {
  discoverExternalCatalog,
  tokenizeExternal,
  type ExternalConnection,
} from "./externalApi";

function usage(): never {
  throw new Error(
    "Usage: pnpm run discover -- <endpoint>\nSet CONTEXT_BRIDGE_API_KEY in the environment when authentication is required.",
  );
}

export async function discoverCommand(
  args: string[],
  apiKey: string,
): Promise<void> {
  const endpoint = args.find((argument) => argument !== "--");
  if (endpoint === undefined || endpoint.trim() === "") usage();
  const connection: ExternalConnection = { endpoint, apiKey };
  const catalog = await discoverExternalCatalog(connection);
  const rows = [];
  for (const model of catalog.models) {
    let tokenizerContext: number | undefined;
    try {
      tokenizerContext = (
        await tokenizeExternal(connection, model.id, [
          { role: "user", content: "Context Bridge discovery probe." },
        ])
      ).contextLength;
    } catch {
      // Discovery remains useful when the endpoint exposes model metadata but not tokenization.
    }
    rows.push({
      model: model.id,
      context: tokenizerContext ?? model.contextLength ?? "unknown",
      tokenization: tokenizerContext === undefined ? "unavailable" : "ok",
      tools:
        model.capabilities?.supports_tool_choice ??
        model.capabilities?.supports_function_calling ??
        "unknown",
      schema: model.capabilities?.supports_response_schema ?? "unknown",
      web: model.capabilities?.supports_web_search ?? "unknown",
      reasoning: model.capabilities?.supports_reasoning ?? "unknown",
      vision: model.capabilities?.supports_vision ?? "unknown",
    });
  }
  console.table(rows);
  for (const warning of catalog.warnings) console.warn(`Warning: ${warning}`);
}

if (require.main === module) {
  discoverCommand(
    process.argv.slice(2),
    process.env.CONTEXT_BRIDGE_API_KEY ?? "",
  ).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
