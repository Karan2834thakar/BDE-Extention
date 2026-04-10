# BDE AI Copilot

Chrome Extension + Express backend that gives real-time AI suggestions during client calls.

## Folder Structure

```text
.
|-- extension
|   |-- background.js
|   |-- manifest.json
|   |-- sidepanel.html
|   |-- sidepanel.js
|   `-- style.css
`-- backend
    |-- .env.example
    |-- package.json
    `-- server.js
```

## Setup

### 1) Backend

```bash
cd backend
npm install
```

Or install required Gemini packages explicitly:

```bash
npm install @google/generative-ai dotenv
```

Create `.env` from `.env.example`:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-1.5-flash
PORT=3000
```

Run backend:

```bash
npm start
```

Expected:

```text
BDE AI Copilot backend running on http://localhost:3000
```

### 2) Load Extension

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `extension` folder.
5. Click the extension icon to open side panel.

## Notes

- Microphone access is requested via `navigator.mediaDevices.getUserMedia`.
- API calls are triggered only on final transcripts after debounce + smart filtering.
