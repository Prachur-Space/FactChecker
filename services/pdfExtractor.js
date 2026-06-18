/**
 * @fileoverview PDF text extraction service using the unpdf library.
 * Accepts a Buffer (e.g. from multer) and returns extracted text with metadata.
 */

import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Extracts text content from a PDF buffer.
 *
 * @param {Buffer} buffer - The raw PDF file buffer (e.g. from multer's memory storage).
 * @returns {Promise<{ text: string, pages: number, textLength: number }>}
 *   An object containing the full extracted text, page count, and character length.
 * @throws {Error} If the buffer is empty, not a valid PDF, or text extraction fails.
 */
export async function extractPdfText(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty or missing PDF buffer. Please upload a valid PDF file.');
  }

  try {
    // Convert Node Buffer to Uint8Array for unpdf compatibility
    const uint8Array = new Uint8Array(buffer);

    // Obtain a document proxy so we can get page count
    const pdf = await getDocumentProxy(uint8Array);
    const pageCount = pdf.numPages;

    if (pageCount === 0) {
      throw new Error('The PDF contains zero pages. Please upload a valid document.');
    }

    // Extract text from all pages
    const { text } = await extractText(pdf, { mergePages: true });
    const trimmedText = (text || '').trim();

    if (trimmedText.length === 0) {
      throw new Error(
        'No extractable text found in the PDF. The document may be scanned images or empty.'
      );
    }

    console.log(
      `[PDFExtractor] Extracted ${pageCount} page(s), ${trimmedText.length} characters`
    );

    return {
      text: trimmedText,
      pages: pageCount,
      textLength: trimmedText.length,
    };
  } catch (error) {
    // Re-throw our own errors as-is
    if (error.message.includes('PDF') || error.message.includes('extractable')) {
      throw error;
    }

    console.error('[PDFExtractor] Extraction failed:', error.message);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}
