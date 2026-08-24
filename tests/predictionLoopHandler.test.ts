import {
  Chat,
  type LLM,
  type PredictionLoopHandlerController,
} from "@lmstudio/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  contextMeasurementFailureText,
  runPrediction,
} from "../src/predictionLoopHandler";

describe("prediction-loop diagnostics", () => {
  it("explains unreachable external endpoints without returning an empty reply", () => {
    expect(
      contextMeasurementFailureText(
        new TypeError("fetch failed", {
          cause: new Error("connect ECONNREFUSED 127.0.0.1:8000"),
        }),
      ),
    ).toMatch(/endpoint is unreachable/i);
  });

  it("explains tokenizer incompatibility for LM Studio and vLLM", () => {
    expect(
      contextMeasurementFailureText(
        new Error("/llm/tokenize returned no usable token count."),
      ),
    ).toMatch(/exact ID of a loaded model.*\/llm\/tokenize/i);
  });

  it("preserves the actionable reserved-context validation", () => {
    expect(
      contextMeasurementFailureText(
        new Error(
          "Reserved context (16000) must be smaller than the model context length (8192).",
        ),
      ),
    ).toBe(
      "Reserved context (16000) must be smaller than the model context length (8192).",
    );
  });

  it("renders local reasoning in LM Studio's native thinking block without tools", async () => {
    const blocks: Array<{
      initialStyle?: unknown;
      text: string;
      styles: unknown[];
      genInfo?: unknown;
    }> = [];
    const abortController = new AbortController();
    const ctl = {
      abortSignal: abortController.signal,
      createContentBlock: (options?: { style?: unknown }) => {
        const record = {
          initialStyle: options?.style,
          text: "",
          styles: [] as unknown[],
          genInfo: undefined as unknown,
        };
        blocks.push(record);
        return {
          appendText: (text: string) => {
            record.text += text;
          },
          setStyle: (style: unknown) => {
            record.styles.push(style);
          },
          attachGenInfo: (genInfo: unknown) => {
            record.genInfo = genInfo;
          },
          pipeFrom: vi.fn(() => {
            throw new Error(
              "pipeFrom must not flatten reasoning into normal text",
            );
          }),
        };
      },
    } as unknown as PredictionLoopHandlerController;
    const marker =
      "__LM_STUDIO_INTERNAL_LSEP_SYNTHETIC_REASONING_END_f4e9a8d2c6b14d0c9e5f3a7b8c1d2e6a__";
    const source = {
      countTokens: vi.fn(),
      getContextLength: vi.fn(),
      applyPromptTemplate: vi.fn(),
      respond: (
        _chat: unknown,
        options?: {
          onPredictionFragment?: (fragment: {
            content: string;
            reasoningType: "none" | "reasoning" | "reasoningEndTag";
          }) => void;
        },
      ) => {
        options?.onPredictionFragment?.({
          content: "analysis",
          reasoningType: "reasoning",
        });
        options?.onPredictionFragment?.({
          content: marker,
          reasoningType: "reasoningEndTag",
        });
        options?.onPredictionFragment?.({
          content: "final answer",
          reasoningType: "none",
        });
        return Promise.resolve({
          modelInfo: { path: "model/path", identifier: "loaded-model" },
          loadConfig: {},
          predictionConfig: {},
          stats: { predictedTokensCount: 2 },
        });
      },
    } as unknown as LLM;

    await runPrediction(ctl, source, Chat.empty(), []);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      initialStyle: { type: "thinking" },
      text: "analysis",
      styles: [{ type: "thinking", ended: true }],
    });
    expect(blocks[1]).toMatchObject({
      initialStyle: undefined,
      text: "final answer",
      genInfo: {
        indexedModelIdentifier: "model/path",
        identifier: "loaded-model",
      },
    });
    expect(
      blocks.some((block) => block.text.includes("LM_STUDIO_INTERNAL")),
    ).toBe(false);
  });
});
