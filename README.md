# Temporal Search Agent

This project is a timestamp-aware chat agent built with Node.js 22 and Express. It uses the Vercel AI SDK to run a Groq-hosted model equipped with a single tool: Tavily Web Search. The server streams Server-Sent Events (SSE) to an included terminal client, which renders the responses and source URLs in real time.

## Quick Start (Local Workspace)

Open PowerShell in the project folder

1. Install dependencies: `npm ci`.
2. Start the server: `npm start`. Leave this terminal open.
3. In a second terminal, run `npm run chat`. Ask at `You:`; type `/quit` to exit.

Keep keys only in `.env`. Restart the server after code or `.env` changes; this clears chat history. Check the printed source links before relying on an answer.

---

## 1. Architectural Blueprint
Please review `design.md` for detailed information on data flow, timestamp logic, latency optimization, reliability limits, and testing strategies.

## 2. Project Scaffolding

```text
minimi/
├── design.md
├── README.md
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
├── src/
│   ├── memory.js
│   ├── search.js
│   ├── agent.js
│   ├── client.js
│   └── server.js
├── scripts/
│   └── check.js
└── test/
    └── core.test.js
```

**Setup from Scratch (Optional)**
If you are recreating this project in a completely new folder, initialize it with these commands:
```bash
mkdir temporal-search-agent
cd temporal-search-agent
npm init -y
npm pkg set type=module
npm install --save-exact ai @ai-sdk/groq express zod
npm install --save-dev --save-exact acorn
```

**Testing the Code**
Run the automated style checker (verifying strict variable limits and no comments) and the offline test suite:
```bash
npm run check
npm test
```

## 3. Core Implementation

Review the source code in this logical order: `src/memory.js`, `src/search.js`, `src/agent.js`, `src/server.js`, and `src/client.js`. 

*Code Constraint Note:* All authored JavaScript variables and functions use strict 1- or 2-character names. Underscores and the lowercase letter `l` are strictly prohibited. The code intentionally omits all comments and blank lines to adhere to challenge constraints.

## 4. API Usage Guide

The backend exposes two main endpoints protected by your custom `AppKey`.

**1. Create a Session**
You must create a session to define the time zone and receive a `sessionId`.
*   **Endpoint:** `POST /sessions`
*   **Headers:** `Authorization: Bearer <Your_AppKey>`
*   **Body:** `{"timeZone": "Asia/Calcutta"}` (Defaults to UTC if omitted).

**2. Chat with the Agent**
Send messages using the `sessionId` retrieved in step 1.
*   **Endpoint:** `POST /chat`
*   **Headers:** `Authorization: Bearer <Your_AppKey>`
*   **Body:** 
```json
{
  "sessionId": "<UUID>",
  "message": "What changed today?",
  "mode": "grounded" 
}
```
*(Mode options: `grounded` forces a web search; `auto` allows the AI to decide).*

**Handling the SSE Response**
The `/chat` endpoint streams Server-Sent Events (SSE) back to the client. Standard REST clients (like `Invoke-WebRequest`) may buffer the stream poorly. Use `fetch` streaming to parse the following event types:
*   `meta`: Identifies the request and timestamp.
*   `sources`: Provides the search result URLs.
*   `text`: Streams the text deltas (the actual answer).
*   `done`: Confirms the response completed successfully.
*   `error`: Indicates the stream failed or was interrupted.

**Memory & State Rules**
*   **Volatility:** Chat history lives in server memory. Restarting the server destroys all sessions.
*   **Expiry:** Sessions expire automatically after 30 minutes of inactivity.
*   **Limits:** If a session hits the maximum token/turn limits, it will cleanly reject new messages rather than silently deleting old context.
*   **Failures:** If a request fails mid-generation, it is saved in the history as "incomplete." Retrying a failed request counts as a brand new turn.
