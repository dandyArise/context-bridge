import type {
  Chat,
  ChatMessage,
  PredictionLoopHandlerController,
  PredictionProcessContentBlockController,
} from "@lmstudio/sdk";
import { archive, loadRecord, saveRecord } from "./archive";
import { createCache } from "./cache";
import {
  buildChat,
  countLeadingSystemMessages,
  findSplitIndex,
  fingerprint,
  folderName,
  memoryNote,
  prefixHash,
  summarize,
} from "./compaction";
import { configSchematics, globalConfigSchematics } from "./config";
import { isMaximumContextError, toOpenAIMessages } from "./externalApi";
import {
  isLocalLLM,
  measureContext,
  measureLocal,
  type ContextMeasurement,
  type TokenSource,
} from "./tokenBudget";
import { capTools } from "./toolCap";

type ToolUseSession = Awaited<
  ReturnType<PredictionLoopHandlerController["startToolUseSession"]>
>;
type SessionTool = ToolUseSession["tools"][number];

interface PreparedChat {
  chat: Chat;
  measurement: ContextMeasurement;
}

function estimateUsed(original: Chat, next: Chat, measured: number): number {
  const before = Math.max(1, JSON.stringify(toOpenAIMessages(original)).length);
  const after = JSON.stringify(toOpenAIMessages(next)).length;
  return Math.max(1, Math.ceil((measured * after) / before));
}

function externalOptions(ctl: PredictionLoopHandlerController) {
  const config = ctl.getPluginConfig(configSchematics);
  const globalConfig = ctl.getGlobalPluginConfig(globalConfigSchematics);
  return {
    connection: {
      endpoint: globalConfig.get("externalEndpoint"),
      apiKey: globalConfig.get("externalApiKey"),
    },
    model: config.get("externalModel"),
    contextLimitOverride: config.get("contextLimitOverride"),
    reserveTokens: config.get("reserveTokens"),
    signal: ctl.abortSignal,
  };
}

export async function handlePredictionLoop(
  ctl: PredictionLoopHandlerController,
): Promise<void> {
  const history = await ctl.pullHistory();
  const source = await ctl.tokenSource();
  const prepared = await prepareChat(ctl, source, history);
  let session: ToolUseSession | undefined;
  let tools: SessionTool[] = [];
  try {
    session = await ctl.startToolUseSession();
    tools = session.tools;
  } catch (error) {
    ctl.debug("Tool use session unavailable:", error);
    ctl.createStatus({
      status: "error",
      text: "Tools are unavailable for this reply because LM Studio refused the tool session.",
    });
  }

  const config = ctl.getPluginConfig(configSchematics);
  const toolBudget = Math.max(
    0,
    prepared.measurement.rawLimit -
      prepared.measurement.reserve -
      prepared.measurement.used,
  );
  try {
    await runPrediction(
      ctl,
      source,
      prepared.chat,
      capTools(tools, {
        maxPerResult: config.get("maxToolResultTokens"),
        budget: toolBudget,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : "";
    if (name === "ToolCallRequestError" || /ToolCallRequest/.test(message)) {
      ctl.createStatus({
        status: "error",
        text: "The model produced a malformed tool call. This reply was stopped safely.",
      });
      return;
    }
    if (isMaximumContextError(error)) {
      ctl.createStatus({
        status: "error",
        text: "The provider reported its maximum context length during this reply. Lower the tool-result ceiling or increase the configured reserve.",
      });
      return;
    }
    throw error;
  } finally {
    session?.[Symbol.dispose]();
  }
}

async function prepareChat(
  ctl: PredictionLoopHandlerController,
  source: TokenSource,
  history: Chat,
): Promise<PreparedChat> {
  const config = ctl.getPluginConfig(configSchematics);
  const messages = history.getMessagesArray();
  const systemCount = countLeadingSystemMessages(messages);
  const key = fingerprint(messages);
  const folder = folderName(messages);
  const vaultPath = config.get("vaultPath").trim();
  const note = vaultPath === "" ? undefined : memoryNote(vaultPath, folder);
  const saved = await loadRecord(vaultPath, key);
  const reusable =
    saved !== undefined &&
    saved.splitIndex < messages.length &&
    saved.prefixHash === prefixHash(messages, saved.splitIndex);
  let candidate = buildChat(history, messages, systemCount, {
    ...(note === undefined ? {} : { memoryNote: note }),
    ...(reusable
      ? { splitIndex: saved.splitIndex, summary: saved.summary }
      : {}),
  });
  let measurement = await measureContext(
    source,
    candidate,
    externalOptions(ctl),
  );
  const measuredCandidate = candidate;
  if (measurement.used <= measurement.limit * config.get("triggerPercent")) {
    return { chat: candidate, measurement };
  }

  const splitIndex = await findSplitIndex(
    messages,
    systemCount,
    config.get("keepRecentTokens"),
    measurement.countMessage,
  );
  if (splitIndex < 0) {
    ctl.debug(
      "Compaction skipped: no safe split point preserves MCP call/result pairs.",
    );
    return { chat: candidate, measurement };
  }

  const announcement = config.get("showStatus")
    ? ctl.createContentBlock({
        includeInContext: false,
        style: { type: "customLabel", label: "Context", color: "blue" },
      })
    : undefined;
  announcement?.appendText("Compacting context…");

  try {
    const compactedMessages = messages.slice(systemCount, splitIndex);
    const result = await summarize(source, compactedMessages, {
      signal: ctl.abortSignal,
      cache: createCache(vaultPath),
      chunkTokens: config.get("chunkTokens"),
      countTokens: measurement.countMessage,
      onProgress: (text) => announcement?.replaceText(text),
    });
    let archivedTo: string | undefined;
    if (vaultPath !== "") {
      archivedTo = await archive(
        vaultPath,
        folder,
        result.summary,
        compactedMessages,
      );
    }
    await saveRecord(vaultPath, key, {
      splitIndex,
      prefixHash: prefixHash(messages, splitIndex),
      summary: result.summary,
      compactedAt: new Date().toISOString(),
    });
    const beforeChat = candidate;
    const beforeUsed = measurement.used;
    candidate = buildChat(history, messages, systemCount, {
      ...(note === undefined ? {} : { memoryNote: note }),
      splitIndex,
      summary: result.summary,
    });
    if (isLocalLLM(source)) {
      measurement = await measureLocal(
        source,
        candidate,
        config.get("reserveTokens"),
      );
    } else {
      measurement = {
        ...measurement,
        used: estimateUsed(beforeChat, candidate, beforeUsed),
      };
    }
    if (measurement.used >= measurement.limit) {
      announcement?.setStyle({
        type: "customLabel",
        label: "Context",
        color: "red",
      });
      announcement?.replaceText(
        `Compaction still uses ${measurement.used}/${measurement.limit} usable tokens. Lower the verbatim tail or increase the context limit.`,
      );
      return { chat: candidate, measurement };
    }
    const reusedCount = result.chunksTotal - result.chunksSummarized;
    announcement?.replaceText(
      `Context compacted: ${beforeUsed} → ${measurement.used} tokens; reserve ${measurement.reserve}; ${compactedMessages.length} messages summarized` +
        (reusedCount > 0
          ? `; ${reusedCount}/${result.chunksTotal} summaries reused`
          : "") +
        (archivedTo === undefined ? "" : `; archived to ${archivedTo}`),
    );
    return { chat: candidate, measurement };
  } catch (error) {
    ctl.debug("Compaction failed:", error);
    announcement?.setStyle({
      type: "customLabel",
      label: "Context",
      color: "red",
    });
    announcement?.replaceText(
      "Compaction failed; the full history will be sent unchanged.",
    );
    const fallbackMeasurement = isLocalLLM(source)
      ? await measureLocal(source, history, config.get("reserveTokens"))
      : {
          ...measurement,
          used: estimateUsed(measuredCandidate, history, measurement.used),
        };
    return { chat: history, measurement: fallbackMeasurement };
  }
}

async function runPrediction(
  ctl: PredictionLoopHandlerController,
  source: TokenSource,
  chat: Chat,
  tools: SessionTool[],
): Promise<void> {
  if (tools.length === 0) {
    const block = ctl.createContentBlock();
    if (isLocalLLM(source)) {
      await block.pipeFrom(source.respond(chat, { signal: ctl.abortSignal }));
    } else {
      const result = await source.respond(chat, { signal: ctl.abortSignal });
      block.appendText(result.content);
    }
    return;
  }

  let content: PredictionProcessContentBlockController | undefined;
  let reasoning: PredictionProcessContentBlockController | undefined;
  const callIds = new Map<string, number>();
  const callIdFor = (id?: string): number => {
    const key = id ?? `anonymous-${callIds.size}`;
    let value = callIds.get(key);
    if (value === undefined) {
      value = callIds.size;
      callIds.set(key, value);
    }
    return value;
  };
  const contentBlock = () => (content ??= ctl.createContentBlock());

  await source.act(chat, tools, {
    signal: ctl.abortSignal,
    onRoundStart: () => {
      content = undefined;
      reasoning = undefined;
    },
    onPredictionFragment: (fragment) => {
      if (fragment.reasoningType === "reasoningStartTag") return;
      if (fragment.reasoningType === "reasoningEndTag") {
        reasoning?.setStyle({ type: "thinking", ended: true });
        return;
      }
      if (fragment.reasoningType === "reasoning") {
        reasoning ??= ctl.createContentBlock({ style: { type: "thinking" } });
        reasoning.appendText(fragment.content);
        return;
      }
      contentBlock().appendText(fragment.content);
    },
    onMessage: (message: ChatMessage) => {
      for (const request of message.getToolCallRequests()) {
        contentBlock().appendToolRequest({
          callId: callIdFor(request.id),
          ...(request.id === undefined
            ? {}
            : { toolCallRequestId: request.id }),
          name: request.name,
          parameters: request.arguments ?? {},
        });
      }
      const results = message.getToolCallResults();
      if (results.length > 0) {
        const block = ctl.createContentBlock({ roleOverride: "tool" });
        for (const result of results) {
          block.appendToolResult({
            callId: callIdFor(result.toolCallId),
            ...(result.toolCallId === undefined
              ? {}
              : { toolCallRequestId: result.toolCallId }),
            content: String(result.content),
          });
        }
      }
    },
  });
}
