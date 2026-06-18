/**
 * @fileoverview Express server for the Fact-Checking Web App.
 * Provides an SSE-based /api/analyze endpoint that streams progress through
 * the PDF extraction → claim identification → claim verification pipeline.
 */

// Load .env file FIRST before anything else
import 'dotenv/config';

import express from 'express';
import multer from 'multer';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractPdfText } from './services/pdfExtractor.js';
import { extractClaims } from './services/claimExtractor.js';
import { verifyClaims } from './services/claimVerifier.js';

// ---------- ESM __dirname equivalent ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Removed static API key check - key is now provided by client
console.log(`✅ Model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}`);

// ---------- Express app setup ----------
const app = express();

// ---------- Middleware ----------
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Multer configuration ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted.'), false);
    }
  },
});

// ---------- Routes ----------

/**
 * GET /api/health
 * Simple health-check endpoint.
 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  });
});

/**
 * POST /api/analyze
 * Accepts a PDF upload and streams analysis progress via SSE.
 *
 * The response is a stream of `data: <JSON>\n\n` events describing each
 * pipeline step: extracting → analyzing → verifying → complete / error.
 */
app.post('/api/analyze', upload.single('pdf'), async (req, res) => {
  // Validate that a file was provided
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file uploaded. Please attach a PDF.' });
  }

  // Validate API key was provided
  const apiKey = req.body.apiKey;
  if (!apiKey) {
    return res.status(400).json({ error: 'Gemini API key is required.' });
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📄 New analysis request: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);
  console.log(`${'='.repeat(60)}`);

  // ---------- SSE headers ----------
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // For Nginx/Render proxy
  res.flushHeaders();

  /**
   * Sends an SSE event to the client.
   *
   * @param {object} data - The event payload.
   */
  function sendEvent(data) {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      console.error('Failed to send SSE event:', e.message);
    }
  }

  try {
    // Step 1: Extract text from PDF
    sendEvent({
      step: 'extracting',
      message: 'Extracting text from PDF...',
      progress: 10,
    });

    const pdfData = await extractPdfText(req.file.buffer);

    sendEvent({
      step: 'extracting',
      message: `Extracted ${pdfData.pages} pages (${pdfData.textLength.toLocaleString()} characters)`,
      progress: 20,
    });

    // Step 2: Identify factual claims
    sendEvent({
      step: 'analyzing',
      message: 'Identifying factual claims...',
      progress: 30,
    });

    const claims = await extractClaims(pdfData.text, apiKey);

    if (claims.length === 0) {
      sendEvent({
        step: 'complete',
        message: 'No verifiable claims found in the document',
        progress: 100,
        data: {
          documentInfo: {
            filename: req.file.originalname,
            pages: pdfData.pages,
            textLength: pdfData.textLength,
          },
          summary: { total: 0, verified: 0, inaccurate: 0, false: 0, unverified: 0 },
          claims: [],
        },
      });
      return;
    }

    sendEvent({
      step: 'analyzing',
      message: `Found ${claims.length} verifiable claims`,
      progress: 45,
    });

    // Step 3: Verify claims against web data
    sendEvent({
      step: 'verifying',
      message: `Verifying ${claims.length} claims against web data...`,
      progress: 50,
    });

    const results = await verifyClaims(claims, apiKey, (current, total) => {
      const progress = 50 + Math.round((current / total) * 45);
      sendEvent({
        step: 'verifying',
        message: `Verified claim ${current} of ${total}...`,
        progress,
        currentClaim: current,
        totalClaims: total,
      });
    });

    // Step 4: Complete
    console.log('✅ Analysis complete!');
    sendEvent({
      step: 'complete',
      message: 'Analysis complete',
      progress: 100,
      data: {
        documentInfo: {
          filename: req.file.originalname,
          pages: pdfData.pages,
          textLength: pdfData.textLength,
        },
        summary: results.summary,
        claims: results.claims,
      },
    });
  } catch (error) {
    console.error('❌ Analysis error:', error);
    sendEvent({
      step: 'error',
      message: error.message || 'An unexpected error occurred during analysis.',
    });
  } finally {
    res.end();
  }
});

// ---------- SPA catch-all ----------
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Error handling middleware ----------
/**
 * Express error handler — catches multer errors and general errors.
 */
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large. Maximum allowed size is 20 MB.',
      });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }

  if (err.message === 'Only PDF files are accepted.') {
    return res.status(415).json({ error: err.message });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\n🚀 FactCheck AI server running on http://localhost:${PORT}`);
  console.log(`   Model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}`);
  console.log(`   Upload limit: 20 MB\n`);
});

// ---------- Graceful shutdown ----------
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully…');
  server.close(() => {
    process.exit(0);
  });
});

export default app;
