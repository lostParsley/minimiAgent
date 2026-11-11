# Design Document: Temporal Search Agent

## How It Works
The Temporal Search Agent routes user queries through a strict, latency-optimized pipeline: User -> Express API -> Memory Manager -> Agent Executor -> Web Search Tool -> SSE Response.

*   **Memory & Temporal Context:** Sessions are created with a designated IANA time zone. The Memory Manager holds a transcript of all interactions in process memory. Before calling the LLM, the system injects the current UTC time, the session time zone, and an exact message-index-to-timestamp table into the system prompt. This gives the model precise temporal awareness to resolve relative dates (e.g., "yesterday") without the overhead of vector retrieval.
*   **Execution & Routing:** Requests specify a mode. `grounded` forces a web search step, while `auto` allows the model to bypass search for conversational queries. The executor uses the Vercel AI SDK with a Groq-hosted model (defaulting to `openai/gpt-oss-120b`).
*   **Web Search Tool:** A single tool (`webSearch`) batches up to three independent queries to Tavily. Results are deduplicated, checked against a 60-second in-memory exact-match cache, and fetched concurrently.
*   **Streaming Transport:** The Express server immediately streams Server-Sent Events (SSE) back to the client. The stream delivers `meta`, `sources`, `text` deltas, and finally a `done` or `error` event, ensuring the client knows exactly when a generation legitimately concludes.

## Why I Built It This Way
*   **State-Machine Memory:** Typical chat arrays are susceptible to race conditions. This memory manager uses a `busy` lease flag. Overlapping requests to the same session return a `409 Conflict` rather than corrupting history.
*   **Deterministic Latency:** Model retries are disabled. The search tool enforces an 8-second deadline per query and a 45-second global deadline. By skipping semantic caching and raw page downloads, the architecture prioritizes low Time-To-First-Token (TTFT) and predictable execution.
*   **Strict Capability Limits:** To protect the Node event loop, the system enforces hard boundaries: 1,000 max sessions, 64 messages per session, a 40,000-byte history limit, and a maximum of one tool invocation per turn.
*   **Adherence to Constraints:** The architecture delegates heavy orchestration to application services rather than LLM tools. All authored variables and functions strictly adhere to the 1-2 character limit, omit `l` and underscores, and lack comments/blank lines to satisfy the specific challenge requirements

## What Was Considered and Rejected
*   **Semantic Answer Caching:** Rejected for this baseline. While vector similarity saves LLM calls, it is unsafe for temporal queries (where "today" changes meaning daily) or negations. The latency cost of embedding, retrieving, and structurally validating entities/dates outweighed the benefits for a V1.
*   **Pre-Publication Verification:** Rejected. Buffering the entire LLM response to programmatically verify its citations against search excerpts would destroy the streaming user experience. Streaming speed was prioritized over guaranteed hallucination prevention.
*   **Vector Database for Memory:** Rejected. Injecting a structured index-to-timestamp table directly into the system prompt is faster, cheaper, and perfectly viable for a 64-message bounded context window.
*   **Multiple Agent Tools:** Rejected. Registering multiple tools increases planning latency and failure rates. A single `webSearch` tool that accepts an array of queries proved much more efficient.

## What I'd Do With Another Week
*   **Distributed State Management:** Move session storage from the volatile Node.js `Map` into Redis. This would allow horizontal scaling across multiple workers and persist history across server restarts.
*   **Multi-User Identity:** Replace the single, shared `AppKey` bearer token with proper OAuth/JWT authentication to bind session ownership to specific users.
*   **Automated Citation Evaluation Pipeline:** Build a robust evaluation script to measure citation accuracy, specifically targeting and penalizing fabricated line markers (e.g., `【3†L1-L4】`), and verifying generated claims against source excerpts.
*   **Safe Semantic Caching:** Implement a composite cache key combining the user's normalized intent, the session's time zone, resolved absolute dates, and prompt version to safely cache semantic hits without temporal drift.