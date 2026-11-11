# Temporal Search Agent
## 1. Architectural blueprint
Read [design.md](design.md) for the data flow, timestamp semantics, latency strategy, reliability limits, and evaluation plan.
## 2. Project scaffolding
```text
temporal-search-agent/
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
│   └── server.js
├── scripts/
│   └── check.js
└── test/
    └── core.test.js
```
Initialize a new folder with these PowerShell commands, then add the supplied files. Skip initialization in this already scaffolded workspace.
```powershell
mkdir temporal-search-agent
cd temporal-search-agent
npm init -y
npm pkg set type=module
npm install --save-exact ai @ai-sdk/anthropic express zod
npm install --save-dev --save-exact acorn
```
For this workspace or a fresh checkout, use the lockfile:
```powershell
npm ci
Copy-Item .env.example .env
```
Set `AnthropicKey`, `TavilyKey`, `AppKey`, and `Model` in `.env`. Use a tool-capable Anthropic model with at least a 128K-token context. `AppKey` must have at least 24 characters; use a cryptographically random value. `.env` is ignored by Git. The server binds to loopback by default.
```powershell
npm run check
npm test
npm start
```
## 3. Core implementation
Read the modules in order: [Memory Manager](src/memory.js), [Search Tool](src/search.js), [Agent Executor](src/agent.js), [Express Server](src/server.js). All authored JavaScript binding names have one or two characters, exclude underscores, and never equal lowercase `l`. Required framework, JSON, and provider property names retain their documented spelling. Code contains no comments or blank lines.
## API usage
Create a session with `POST /sessions`, an `Authorization: Bearer <AppKey>` header, and JSON `{"timeZone":"Asia/Calcutta"}`. Save the returned `sessionId`. Use that ID for every later turn in the conversation.
Call `POST /chat` with the same authorization header and JSON `{"sessionId":"<returned UUID>","message":"What changed today?","mode":"grounded"}`. `grounded` forces search; `auto` permits a direct conversational response. Defaults are UTC and grounded mode. The time zone is fixed when creating the session.
The response is SSE: `meta` identifies the turn; `sources` contains citation URLs and search availability; `text` contains text deltas; `done` confirms that the answer was committed. An `error` event means the answer is incomplete, even if text has already appeared. Parse event frames across arbitrary network chunk boundaries. Use fetch streaming for this POST endpoint and preserve Markdown until enough text is available to render it safely.
The history is held in process memory and expires after 30 minutes of inactivity. Full sessions reject further messages rather than silently forgetting them. Restarting the server erases memory. Failed requests after acceptance remain in history with an incomplete response marker; retries are new turns and are not idempotent. Do not automatically replay a request whose terminal SSE event was lost.
The shared application key and session capabilities suit a trusted challenge client. Add per-user identity and ownership checks before exposing this as a public multi-user service. No real provider call is needed by the offline suite; live quality and latency evaluation requires configured credentials.
