/**
 * @fileoverview Centralized Gemini API client using the @google/genai SDK.
 * Provides singleton access, retry logic, and search-grounded generation.
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Returns a new GoogleGenAI instance using the provided API key.
 *
 * @param {string} apiKey - The Gemini API key provided by the client.
 * @returns {GoogleGenAI} The GoogleGenAI instance.
 */
export function getAI(apiKey) {
  if (!apiKey) {
    throw new Error('API key is missing.');
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Returns the configured model name from the environment or the default.
 *
 * @returns {string} The Gemini model name.
 */
export function getModelName() {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

/**
 * Determines whether an error is retryable (429 Too Many Requests or 503 Service Unavailable).
 *
 * @param {Error} error - The error to inspect.
 * @returns {boolean} True if the request should be retried.
 */
function isRetryableError(error) {
  const message = error?.message || '';
  const status = error?.status || error?.httpStatusCode || error?.code || 0;

  if (status === 429 || status === 503) return true;
  if (message.includes('429') || message.includes('Too Many Requests')) return true;
  if (message.includes('503') || message.includes('Service Unavailable')) return true;
  if (message.includes('RESOURCE_EXHAUSTED')) return true;
  if (message.includes('UNAVAILABLE')) return true;
  if (message.includes('DEADLINE_EXCEEDED')) return true;

  return false;
}

/**
 * Pauses execution for the given number of milliseconds.
 *
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates an AbortSignal that times out after the given milliseconds.
 *
 * @param {number} ms - Timeout in milliseconds.
 * @returns {AbortSignal}
 */
function timeoutSignal(ms) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * Generates content via the Gemini API with automatic retry and exponential backoff
 * for transient errors (429 / 503). Up to 3 retries are attempted.
 *
 * @param {string} prompt - The text prompt to send to Gemini.
 * @param {object} [options={}] - Additional options merged into the generateContent config.
 * @param {string} [options.responseMimeType] - Desired response MIME type (e.g. 'application/json').
 * @param {object} [options.responseSchema] - JSON schema for structured output.
 * @param {Array}  [options.tools] - Tool configurations (e.g. googleSearch).
 * @param {string} apiKey - The Gemini API key.
 * @returns {Promise<object>} The raw response from Gemini.
 * @throws {Error} If all retries are exhausted or a non-retryable error occurs.
 */
export async function generateContent(prompt, options = {}, apiKey) {
  const ai = getAI(apiKey);
  const model = getModelName();
  const maxRetries = 3;
  const baseDelay = 2000; // 2 seconds

  console.log(`[GeminiClient] Calling model: ${model}`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const config = { ...options };

      // Wrap in a timeout promise (60 seconds)
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: prompt,
          config,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API call timed out after 60 seconds')), 60000)
        ),
      ]);

      if (!response) {
        throw new Error('Empty response from Gemini API');
      }

      console.log(`[GeminiClient] Got response (attempt ${attempt + 1})`);
      return response;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;

      console.error(`[GeminiClient] Error on attempt ${attempt + 1}/${maxRetries + 1}:`, error.message);

      if (isRetryableError(error) && !isLastAttempt) {
        const delay = baseDelay * Math.pow(2, attempt); // 2s, 4s, 8s
        console.warn(
          `[GeminiClient] Retryable error. Retrying in ${delay}ms…`
        );
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }
}

/**
 * Generates content with Google Search grounding enabled.
 * This instructs Gemini to use live web search results when formulating its answer.
 *
 * @param {string} prompt - The text prompt to send to Gemini.
 * @param {string} apiKey - The Gemini API key.
 * @returns {Promise<object>} The raw response from Gemini (includes groundingMetadata).
 */
export async function generateContentWithSearch(prompt, apiKey) {
  return generateContent(
    prompt,
    {
      tools: [{ googleSearch: {} }],
    },
    apiKey
  );
}
