/**
 * @fileoverview Bulk claim verification service using Gemini with Google Search grounding.
 * Verifies multiple claims in a single API call to conserve the strict 20/day free tier quota.
 */

import { generateContentWithSearch } from './geminiClient.js';

/**
 * Number of claims to bundle into a single prompt.
 * 10 is a good balance between reducing API calls and keeping the prompt focused enough for search grounding.
 */
const BULK_BATCH_SIZE = 10;

/**
 * Builds the bulk fact-checking prompt for multiple claims.
 *
 * @param {Array<object>} claims - The array of claims to verify.
 * @returns {string} The verification prompt.
 */
function buildBulkVerificationPrompt(claims) {
  let prompt = `You are a rigorous fact-checker. I have ${claims.length} claims that need verification.
Search the web thoroughly for current, reliable information for EACH claim.

Here are the claims to verify:

`;

  claims.forEach((c, index) => {
    prompt += `[CLAIM_ID: ${index}]\n`;
    prompt += `Claim: "${c.claim}"\n`;
    prompt += `Category: ${c.category}\n`;
    prompt += `Context: "${c.context}"\n\n`;
  });

  prompt += `Respond by verifying EACH claim one by one. Use EXACTLY this text format for each claim, separated by "---":

CLAIM_ID: [The ID number from above]
STATUS: [verified|inaccurate|false]
CONFIDENCE: [high|medium|low]
EXPLANATION: [Your detailed explanation of why this claim is verified, inaccurate, or false. Cite specific data points you found.]
CORRECT_INFO: [If inaccurate or false, provide the correct/current information with specifics. If verified, write 'N/A']
---
`;

  return prompt;
}

/**
 * Parses the bulk structured text response from Gemini into verification results.
 *
 * @param {string} text - The raw text response from Gemini.
 * @param {Array<object>} originalClaims - The original claims array to map against.
 * @returns {Array<object>} Array of verification results.
 */
function parseBulkVerificationResponse(text, originalClaims) {
  const results = new Map();
  
  if (!text) return Array(originalClaims.length).fill(null);

  // Split the response by the "---" separator
  const blocks = text.split(/---|\n\n(?=CLAIM_ID:)/);

  for (const block of blocks) {
    if (!block.trim() || !block.includes('CLAIM_ID:')) continue;

    // Extract CLAIM_ID
    const idMatch = block.match(/CLAIM_ID:\s*(\d+)/i);
    if (!idMatch) continue;
    
    const claimId = parseInt(idMatch[1], 10);
    if (isNaN(claimId) || claimId < 0 || claimId >= originalClaims.length) continue;

    const result = {
      status: 'unverified',
      confidence: 'low',
      explanation: '',
      correctInfo: '',
    };

    // Extract STATUS
    const statusMatch = block.match(/STATUS:\s*(verified|inaccurate|false)/i);
    if (statusMatch) {
      result.status = statusMatch[1].toLowerCase();
    } else {
      const lower = block.toLowerCase();
      if (lower.includes('inaccurate') || lower.includes('incorrect') || lower.includes('outdated')) {
        result.status = 'inaccurate';
      } else if (lower.includes('false') || lower.includes('no evidence')) {
        result.status = 'false';
      } else if (lower.includes('verified') || lower.includes('accurate') || lower.includes('correct')) {
        result.status = 'verified';
      }
    }

    // Extract CONFIDENCE
    const confidenceMatch = block.match(/CONFIDENCE:\s*(high|medium|low)/i);
    if (confidenceMatch) {
      result.confidence = confidenceMatch[1].toLowerCase();
    } else {
      result.confidence = result.status === 'unverified' ? 'low' : 'medium';
    }

    // Extract EXPLANATION
    const explanationMatch = block.match(/EXPLANATION:\s*([\s\S]*?)(?=\nCORRECT_INFO:|$)/i);
    if (explanationMatch) {
      result.explanation = explanationMatch[1].trim();
    } else {
      result.explanation = block.trim().slice(0, 500);
    }

    // Extract CORRECT_INFO
    const correctInfoMatch = block.match(/CORRECT_INFO:\s*([\s\S]*?)$/i);
    if (correctInfoMatch) {
      result.correctInfo = correctInfoMatch[1].trim();
    }

    results.set(claimId, result);
  }

  // Map back to the array, filling missing ones with default 'unverified'
  return originalClaims.map((_, index) => {
    return results.get(index) || {
      status: 'unverified',
      confidence: 'low',
      explanation: 'Could not parse verification result from the model.',
      correctInfo: null,
    };
  });
}

/**
 * Extracts grounding source URLs and titles from the Gemini response metadata.
 * Note: For bulk, all sources are combined since the metadata is at the response level.
 *
 * @param {object} response - The raw Gemini API response.
 * @returns {Array<{ title: string, url: string }>} Array of source objects.
 */
function extractSources(response) {
  try {
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    return chunks
      .map((chunk) => ({
        title: chunk.web?.title || 'Source',
        url: chunk.web?.uri || '',
      }))
      .filter((source) => source.url);
  } catch (e) {
    console.warn('[ClaimVerifier] Could not extract grounding sources:', e.message);
    return [];
  }
}

/**
 * Verifies an array of claims in bulk batches to aggressively conserve API quota.
 *
 * @param {Array<{ claim: string, category: string, context: string }>} claims
 *   The claims to verify.
 * @param {string} apiKey - The Gemini API key.
 * @param {function(number, number): void} [onProgress] - Optional progress callback
 * @returns {Promise<{ summary: object, claims: Array<object> }>}
 */
export async function verifyClaims(claims, apiKey, onProgress) {
  if (!claims || claims.length === 0) {
    return {
      summary: { total: 0, verified: 0, inaccurate: 0, false: 0, unverified: 0 },
      claims: [],
    };
  }

  console.log(`[ClaimVerifier] Verifying ${claims.length} claim(s) in BULK mode (batch size: ${BULK_BATCH_SIZE}) to conserve daily quota...`);

  const verifiedClaims = [];
  let completed = 0;

  for (let i = 0; i < claims.length; i += BULK_BATCH_SIZE) {
    const batch = claims.slice(i, i + BULK_BATCH_SIZE);
    const batchNum = Math.floor(i / BULK_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(claims.length / BULK_BATCH_SIZE);
    
    console.log(`[ClaimVerifier] Processing bulk batch ${batchNum}/${totalBatches} containing ${batch.length} claims...`);
    
    try {
      const prompt = buildBulkVerificationPrompt(batch);
      const response = await generateContentWithSearch(prompt, apiKey);
      
      const responseText = response.text ?? '';
      console.log(`[ClaimVerifier] Got bulk response (${responseText.length} chars)`);
      
      const parsedResults = parseBulkVerificationResponse(responseText, batch);
      const allSources = extractSources(response);
      
      // Merge results with claims
      for (let j = 0; j < batch.length; j++) {
        const claim = batch[j];
        const result = parsedResults[j];
        
        verifiedClaims.push({
          ...claim,
          status: result.status,
          confidence: result.confidence,
          explanation: result.explanation,
          correctInfo: result.correctInfo && result.correctInfo !== 'N/A' ? result.correctInfo : null,
          sources: allSources // Attach all search sources from this API call to each claim
        });
        
        completed++;
        if (typeof onProgress === 'function') {
          onProgress(completed, claims.length);
        }
      }
      
    } catch (error) {
      console.error(`[ClaimVerifier] Bulk verification failed for batch ${batchNum}:`, error.message);
      
      // Mark all claims in this batch as unverified due to error
      for (const claim of batch) {
        verifiedClaims.push({
          ...claim,
          status: 'unverified',
          confidence: 'low',
          explanation: `Bulk verification failed: ${error.message}`,
          correctInfo: null,
          sources: [],
        });
        
        completed++;
        if (typeof onProgress === 'function') {
          onProgress(completed, claims.length);
        }
      }
    }
  }

  // Build summary
  const summary = {
    total: verifiedClaims.length,
    verified: verifiedClaims.filter((c) => c.status === 'verified').length,
    inaccurate: verifiedClaims.filter((c) => c.status === 'inaccurate').length,
    false: verifiedClaims.filter((c) => c.status === 'false').length,
    unverified: verifiedClaims.filter((c) => c.status === 'unverified').length,
  };

  console.log(
    `[ClaimVerifier] Verification complete — ` +
    `${summary.verified} verified, ${summary.inaccurate} inaccurate, ` +
    `${summary.false} false, ${summary.unverified} unverified`
  );

  const indexedClaims = verifiedClaims.map((claim, index) => ({
    id: index + 1,
    ...claim,
  }));

  return { summary, claims: indexedClaims };
}
