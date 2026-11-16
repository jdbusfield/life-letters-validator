import OpenAI from "openai";

let client;
export function getValidationClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Word validation is not configured");
  return client ||= new OpenAI({ timeout: 30_000, maxRetries: 1 });
}
