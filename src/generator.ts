import { GoogleGenerativeAI } from "@google/generative-ai";
import { Ajv, type ErrorObject } from "ajv";
import type { AggregateInput, ReportInput, ReportOutput } from "./types.js";

export type GeneratorConfig = {
  apiKey: string;
  model: string;
  promptTemplate?: string;
  outputFormat: "markdown" | "json";
  outputSchemaJson?: string;
  validateSchema: boolean;
  maxTokensHint?: number;
};

export const basePrompt = `You are a helpful reporter that summarizes GitHub activity.

Return the response in the requested format. Be concise and factual. Highlight notable changes and themes.
If repositories have no commits in the window, do not list them individually; instead report a single line with the count.
Use any repo context provided (overview, readme, llm.txt, diff summaries, diff snippets, PRs, issues) to explain what the project is and what changed.`;

export const aggregatePrompt = `You are a helpful reporter that summarizes a set of daily GitHub activity reports.

Return the response in the requested format. Be concise and factual. Highlight notable changes and themes across the window.
Do not invent details; only summarize what is present in the daily reports.`;

export async function generateReport(
  input: ReportInput,
  config: GeneratorConfig
): Promise<ReportOutput> {
  const client = new GoogleGenerativeAI(config.apiKey);
  const model = client.getGenerativeModel({ model: config.model });

  const prompt = buildPrompt(input, config);
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const normalized = normalizeOutput(text, config);

  return {
    format: config.outputFormat,
    text: normalized
  };
}

export async function generateAggregateReport(
  input: AggregateInput,
  config: GeneratorConfig
): Promise<ReportOutput> {
  const client = new GoogleGenerativeAI(config.apiKey);
  const model = client.getGenerativeModel({ model: config.model });

  const prompt = buildAggregatePrompt(input, config);
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const normalized = normalizeOutput(text, config);

  return {
    format: config.outputFormat,
    text: normalized
  };
}

function buildPrompt(input: ReportInput, config: GeneratorConfig) {
  const schemaSection = config.outputSchemaJson
    ? `Output must match this JSON schema:\n${config.outputSchemaJson}`
    : "";
  const tokenHint = config.maxTokensHint
    ? `Keep the output under ${config.maxTokensHint} tokens.`
    : "";

  const template = config.promptTemplate ?? basePrompt;

  return [
    template,
    schemaSection,
    tokenHint,
    "Activity window:",
    `${input.window.start} to ${input.window.end}`,
    "Owner:",
    `${input.owner} (${input.ownerType})`,
    "Data:",
    JSON.stringify(input, null, 2),
    `Output format: ${config.outputFormat}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildAggregatePrompt(input: AggregateInput, config: GeneratorConfig) {
  const schemaSection = config.outputSchemaJson
    ? `Output must match this JSON schema:\n${config.outputSchemaJson}`
    : "";
  const tokenHint = config.maxTokensHint
    ? `Keep the output under ${config.maxTokensHint} tokens.`
    : "";

  const template = config.promptTemplate ?? aggregatePrompt;
  const itemsText = input.items
    .map((item) => `# ${item.date}\n${item.content}`)
    .join("\n\n");

  return [
    template,
    schemaSection,
    tokenHint,
    "Aggregation window:",
    `${input.window.start} to ${input.window.end}`,
    "Owner:",
    `${input.owner} (${input.ownerType})`,
    "Source:",
    `${input.source.jobId} (${input.source.templateId})`,
    "Daily reports:",
    itemsText,
    `Output format: ${config.outputFormat}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeOutput(text: string, config: GeneratorConfig) {
  if (config.outputFormat !== "json") {
    return text;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("LLM output is not valid JSON.");
  }

  if (config.validateSchema && config.outputSchemaJson) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(config.outputSchemaJson);
    const validate = ajv.compile(schema);
    const valid = validate(parsed);
    if (!valid) {
      const details = validate.errors
        ?.map((err: ErrorObject) => err.message)
        .join(", ");
      const payload = JSON.stringify(validate.errors ?? []);
      throw new Error(
        `LLM output failed schema validation: ${details}. Errors: ${payload}`
      );
    }
  }

  return JSON.stringify(parsed, null, 2);
}
