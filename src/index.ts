import type { PluginContext } from "@lmstudio/sdk";
import { configSchematics, globalConfigSchematics } from "./config";
import { handlePredictionLoop } from "./predictionLoopHandler";

export function main(context: PluginContext): Promise<void> {
  context
    .withGlobalConfigSchematics(globalConfigSchematics)
    .withConfigSchematics(configSchematics)
    .withPredictionLoopHandler(handlePredictionLoop);
  return Promise.resolve();
}
