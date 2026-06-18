# FactCheck AI — Automated Claim Verification

> Upload a PDF. Verify every claim. Powered by Gemini AI + Google Search.

FactCheck AI is an intelligent fact-checking web application that automates the verification of claims found in PDF documents. It extracts specific factual assertions (statistics, dates, financial figures, technical specs) and cross-references each one against live web data to flag inaccuracies.

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini_AI-2.0_Flash-4285F4?logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ Features

- **PDF Upload** — Drag-and-drop or click to upload any PDF document
- **Smart Claim Extraction** — AI identifies specific, verifiable factual claims (stats, dates, figures)
- **Live Web Verification** — Each claim is checked against current web sources using Google Search grounding
- **Detailed Reports** — Claims flagged as ✅ Verified, ⚠️ Inaccurate, or ❌ False
- **Source Citations** — Every verdict includes links to the sources used for verification
- **Real-Time Progress** — SSE streaming shows live progress as claims are processed
- **Export Results** — Download the full analysis as a JSON file
- **Premium UI** — Dark theme with glassmorphism, animations, and responsive design

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (Frontend)                 │
│  Upload PDF → Show Progress (SSE) → Render Results      │
└─────────────────────┬───────────────────────────────────┘
                      │ POST /api/analyze (multipart + SSE)
┌─────────────────────▼───────────────────────────────────┐
│                   Express Server                         │
│                                                          │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │ PDF Extractor │→│ Claim Extractor │→│Claim Verifier │ │
│  │   (unpdf)    │  │  (Gemini AI)   │  │(Gemini+Search)│ │
│  └──────────────┘  └────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Two-Phase AI Pipeline:**
1. **Extraction** — Gemini analyzes the full text to identify verifiable claims (no web search)
2. **Verification** — Each claim is individually verified using Gemini + Google Search grounding for live web data

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher
- A [Google Gemini API Key](https://aistudio.google.com/apikey)

### Local Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-username/fact-checker.git
cd fact-checker

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env

# 4. Add your Gemini API key to .env
# GEMINI_API_KEY=your-api-key-here

# 5. Start the development server
npm run dev

# 6. Open http://localhost:3000 in your browser
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | ✅ Yes | — | Your Google Gemini API key |
| `PORT` | No | `3000` | Server port (set automatically on Render) |
| `GEMINI_MODEL` | No | `gemini-2.0-flash` | Gemini model to use |

---

## 🌐 Deploy to Render

1. Push your code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com/) → **New** → **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment Variables**: Add `GEMINI_API_KEY`
5. Click **Deploy**

Render automatically detects the `PORT` environment variable.

---

## 📡 API Reference

### `GET /api/health`

Health check endpoint.

**Response:**
```json
{ "status": "ok", "timestamp": "2025-01-01T00:00:00.000Z" }
```

### `POST /api/analyze`

Upload a PDF for fact-checking. Returns a Server-Sent Events (SSE) stream.

**Request:** `multipart/form-data` with a `pdf` field containing the PDF file (max 20MB).

**SSE Events:**

| Step | Description | Example |
|------|-------------|---------|
| `extracting` | Extracting text from PDF | `{"step":"extracting","message":"Extracting text...","progress":10}` |
| `analyzing` | Identifying factual claims | `{"step":"analyzing","message":"Found 12 claims","progress":45}` |
| `verifying` | Verifying claims against web | `{"step":"verifying","message":"Verified 3 of 12...","progress":65}` |
| `complete` | Analysis finished | `{"step":"complete","progress":100,"data":{...}}` |
| `error` | An error occurred | `{"step":"error","message":"Error details"}` |

**Complete Event Data:**
```json
{
  "documentInfo": {
    "filename": "report.pdf",
    "pages": 5,
    "textLength": 12340
  },
  "summary": {
    "total": 12,
    "verified": 7,
    "inaccurate": 3,
    "false": 2
  },
  "claims": [
    {
      "id": 1,
      "claim": "Global GDP grew by 3.1% in 2024",
      "category": "financial",
      "context": "According to the report, global GDP grew by 3.1% in 2024.",
      "status": "verified",
      "explanation": "This matches World Bank data...",
      "correctInfo": null,
      "sources": [{ "title": "World Bank", "url": "https://..." }],
      "confidence": "high"
    }
  ]
}
```

---

## 📁 Project Structure

```
fact-checker/
├── server.js                 # Express server with SSE endpoint
├── package.json              # Dependencies and scripts
├── .env.example              # Environment variable template
├── .gitignore
├── README.md
├── services/
│   ├── geminiClient.js       # Gemini API client with retry logic
│   ├── pdfExtractor.js       # PDF text extraction (unpdf)
│   ├── claimExtractor.js     # Claim extraction via Gemini
│   └── claimVerifier.js      # Claim verification with Google Search
└── public/
    ├── index.html            # Frontend HTML
    ├── css/
    │   └── styles.css        # Premium dark theme styles
    └── js/
        └── app.js            # Frontend JavaScript
```

---

## 🧪 How It Works

1. **Upload**: User uploads a PDF document
2. **Extract**: `unpdf` extracts all text content from the PDF
3. **Identify**: Gemini AI analyzes the text and extracts specific, verifiable claims
4. **Verify**: Each claim is sent to Gemini with Google Search grounding enabled
5. **Report**: Results are streamed back in real-time with verdicts, explanations, and sources

### Claim Categories
- **Statistic** — Numbers, percentages, data points
- **Date** — Historical dates, timelines, deadlines
- **Financial** — Revenue, valuations, economic data
- **Technical** — Specs, measurements, technical claims
- **Scientific** — Research findings, scientific facts
- **General** — Other verifiable factual assertions

### Verdicts
- ✅ **Verified** — Claim matches current, reliable web sources
- ⚠️ **Inaccurate** — Claim contains outdated or incorrect information (correct info provided)
- ❌ **False** — No credible evidence found to support the claim

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

Built with ❤️ using [Gemini AI](https://ai.google.dev/) and [Google Search](https://google.com)
