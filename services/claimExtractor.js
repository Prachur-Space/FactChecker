/**
 * @fileoverview Claim extraction service using Gemini.
 * Identifies verifiable factual claims from text, with chunking and deduplication
 * for long documents. Uses prompt-based JSON extraction (more reliable than responseSchema).
 */

import { generateContent } from './geminiClient.js';

/**
 * Maximum character length before text is split into overlapping chunks.
 * @constant {number}
 */
const CHUNK_THRESHOLD = 30000;

/**
 * Size of each chunk when splitting long text.
 * @constant {number}
 */
const CHUNK_SIZE = 25000;

/**
 * Overlap between consecutive chunks to avoid missing claims at boundaries.
 * @constant {number}
 */
const CHUNK_OVERLAP = 2000;

/**
 * Builds the claim-extraction prompt for a given text block.
 *
 * @param {string} text - The document text (or chunk) to analyze.
 * @returns {string} The fully formatted prompt.
 */
function buildPrompt(text) {
  return `You are an expert fact-checker and research analyst. Your task is to identify ALL specific, verifiable factual claims in the following text.

RULES — read carefully:
1. Focus on claims that contain: statistics, percentages, numerical data, dates, financial figures, technical specifications, named facts, comparisons, or quantitative assertions.
2. IGNORE: opinions, subjective statements, vague claims without specific data, marketing superlatives ("best", "leading"), rhetorical questions, and future predictions that cannot be verified.
3. Each claim must be independently verifiable against public data sources.
4. Extract the claim as a concise but complete statement — do NOT truncate important details.
5. Assign exactly ONE category per claim from these options: statistic, date, financial, technical, scientific, general
6. Include enough surrounding context (1–2 sentences) so a fact-checker understands where the claim appears.

TEXT TO ANALYZE:
"""
${text}
"""

You MUST respond with ONLY a valid JSON object in this exact format, no other text:
{
  "claims": [
    {
      "claim": "The specific factual assertion",
      "category": "statistic",
      "context": "The surrounding sentence from the document"
    }
  ]
}

If there are no verifiable claims, respond with: {"claims": []}`;
}

/**
 * Splits long text into overlapping chunks for processing.
 *
 * @param {string} text - The full document text.
 * @returns {string[]} An array of text chunks.
 */
function chunkText(text) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));

    // Advance by chunk size minus overlap, but not past end
    start += CHUNK_SIZE - CHUNK_OVERLAP;
    if (start >= text.length) break;
  }

  console.log(`[ClaimExtractor] Split text into ${chunks.length} overlapping chunk(s)`);
  return chunks;
}

/**
 * Deduplicates claims by comparing their normalized claim text.
 * Two claims are considered duplicates if one contains the other or if they
 * share a high degree of overlap.
 *
 * @param {Array<{ claim: string, category: string, context: string }>} claims
 * @returns {Array<{ claim: string, category: string, context: string }>} Deduplicated claims.
 */
function deduplicateClaims(claims) {
  const seen = new Map();

  for (const item of claims) {
    const normalised = item.claim.toLowerCase().trim();

    let isDuplicate = false;
    for (const [existing] of seen) {
      // If one claim is a substring of the other, treat as duplicate
      if (existing.includes(normalised) || normalised.includes(existing)) {
        isDuplicate = true;
        // Keep the longer (more complete) version
        if (normalised.length > existing.length) {
          seen.delete(existing);
          seen.set(normalised, item);
        }
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(normalised, item);
    }
  }

  return Array.from(seen.values());
}

/**
 * Attempts to parse JSON from a response string, handling common edge cases
 * like markdown code fences and extra whitespace.
 *
 * @param {string} raw - The raw response text from Gemini.
 * @returns {object|null} Parsed JSON object or null if parsing fails.
 */
function parseJsonResponse(raw) {
  if (!raw || raw.trim().length === 0) return null;

  let text = raw.trim();

  // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');

  // Try direct parse
  try {
    return JSON.parse(text);
  } catch (e) {
    // Try to find JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        // ignore
      }
    }
  }

  return null;
}

/**
 * Extracts claims from a single text block using Gemini.
 *
 * @param {string} text - The text block to analyze.
 * @param {string} apiKey - The Gemini API key.
 * @returns {Promise<Array<{ claim: string, category: string, context: string }>>}
 */
async function extractClaimsFromBlock(text, apiKey) {
  const prompt = buildPrompt(text);

  console.log(`[ClaimExtractor] Sending extraction request to Gemini...`);

  const response = await generateContent(
    prompt,
    { responseMimeType: 'application/json' },
    apiKey
  );

  const raw = response.text ?? '';
  console.log(`[ClaimExtractor] Got response (${raw.length} chars)`);

  const parsed = parseJsonResponse(raw);

  if (!parsed) {
    console.error('[ClaimExtractor] Failed to parse Gemini JSON response');
    console.error('[ClaimExtractor] Raw response (first 500 chars):', raw.slice(0, 500));
    return [];
  }

  const claims = parsed.claims || parsed || [];
  const result = Array.isArray(claims) ? claims : [];

  // Validate claim structure
  const validClaims = result.filter(c =>
    c && typeof c.claim === 'string' && c.claim.trim().length > 0
  ).map(c => ({
    claim: c.claim.trim(),
    category: ['statistic', 'date', 'financial', 'technical', 'scientific', 'general'].includes(c.category)
      ? c.category
      : 'general',
    context: (c.context || c.claim).trim(),
  }));

  console.log(`[ClaimExtractor] Parsed ${validClaims.length} valid claim(s) from block`);
  return validClaims;
}

/**
 * Extracts all verifiable factual claims from a document's text.
 * Automatically chunks long texts and deduplicates the results.
 *
 * @param {string} text - The full document text.
 * @param {string} apiKey - The Gemini API key.
 * @returns {Promise<Array<{ claim: string, category: string, context: string }>>}
 *   Array of extracted claim objects.
 * @throws {Error} If the text is empty or extraction fails entirely.
 */
export async function extractClaims(text, apiKey) {
  if (!text || text.trim().length === 0) {
    throw new Error('No text provided for claim extraction.');
  }

  const trimmed = text.trim();
  console.log(`[ClaimExtractor] Analyzing text (${trimmed.length} characters)…`);

  let allClaims = [];

  if (trimmed.length > CHUNK_THRESHOLD) {
    // Process in overlapping chunks
    const chunks = chunkText(trimmed);

    for (let i = 0; i < chunks.length; i++) {
      console.log(`[ClaimExtractor] Processing chunk ${i + 1}/${chunks.length}…`);
      try {
        const chunkClaims = await extractClaimsFromBlock(chunks[i], apiKey);
        allClaims.push(...chunkClaims);
      } catch (error) {
        console.error(`[ClaimExtractor] Error processing chunk ${i + 1}:`, error.message);
        // Continue with other chunks
      }
    }

    // Deduplicate across chunks
    allClaims = deduplicateClaims(allClaims);
    console.log(`[ClaimExtractor] After deduplication: ${allClaims.length} unique claim(s)`);
  } else {
    allClaims = await extractClaimsFromBlock(trimmed, apiKey);
  }

  if (allClaims.length === 0) {
    console.warn('[ClaimExtractor] No claims extracted from the document');
  }

  console.log(`[ClaimExtractor] Extracted ${allClaims.length} verifiable claim(s)`);
  return allClaims;
}
