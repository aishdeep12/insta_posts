# Aishdeep's Control Room (self-hosted)

A multi-level agent organization with a control-room UI. **Root Master** leads **domain Masters**, each with their own **sub-agents**. You run it on your own machine and change the model underneath with one setting.

```
Root Master
├─ Social Master        Trend Scout · Maker · Poster   (the Instagram pipeline)
└─ any domain you create, each with the sub-agents its Master proposes
```

## Run it

Needs Node 18+ (Python 3 only if you integrate Python code).

```bash
cp .env.example .env        # choose a model, see below
npm install                 # installs sharp, used to render slide PNGs
npm start                   # open http://127.0.0.1:8787
npm test                    # 16 checks with a built-in mock model, no keys needed
```

## Swap the model (the only change needed to go cheaper)

Edit `.env`, restart. Nothing else changes.

| Want | `.env` |
|---|---|
| Local and free (Ollama) | `LLM_PROVIDER=ollama` `LLM_MODEL=llama3.1:8b` `LLM_BASE_URL=http://127.0.0.1:11434` |
| LM Studio / llama.cpp / vLLM / OpenRouter / OpenAI | `LLM_PROVIDER=openai` `LLM_BASE_URL=<server>/v1` `LLM_MODEL=<name>` `LLM_API_KEY=<key if needed>` |
| Claude API | `LLM_PROVIDER=anthropic` `LLM_MODEL=<model id>` `LLM_API_KEY=<key>` |

Agents use tools through a plain JSON protocol in the prompt (`{"tool":...,"args":...}` or `{"final":...}`), not a vendor tool-calling API, so small models work as long as they can follow the format. JSON answers are retried once if the model returns bad JSON. Very small models will make more mistakes; if agent creation or tool use gets flaky, move up a model size before debugging anything else.

## How the organization works

- **Root Master** is the entry route for system-wide changes: create a domain, remove or edit any agent, route a task, message any Master, and propose configuration changes.
- **Domain Masters** run their own team: add, edit or remove agents in their own team, delegate tasks, message other Masters. They cannot remove or edit each other or themselves.
- **Sub-agents** answer inside their speciality and talk to their own Master and teammates.
- Create a domain from the form or by telling Root Master in its chat. Root creates a domain Master, writes its registry record and proposes 2 or 3 sub-agents. A Master can add more later.
- Click any agent on the map to chat with it. Messages between agents show in the event log and in both chats.
- Config changes: Root can only *propose* (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`, `SEARCH_PROVIDER`, `DRY_RUN`, `ACCOUNT_HANDLE`). A banner under the chat asks you to approve. API keys and tokens can never be changed from the UI. Approved changes are saved in `data/config.override.json`.

The permission rules are enforced in the page's tool layer and stated to every agent. They are not a security boundary against a malicious model, so treat the UI as a single-user tool.

## Bring your own code into the pipeline

In the registry panel, use **Integrate your code**: paste or choose a Python or Node script, add instructions, pick which Master it reports to.

1. Master (the model) writes the registry record: name, role, speciality, routing keywords, what it takes and returns. Optionally it adapts your script to the stdin/stdout contract (your original is kept as `original.*`).
2. The code is stored in `data/plugins/<id>/` as **pending**. It does not run.
3. You read it in the review panel and click **Approve and enable**.
4. From then on it is a normal agent: Root and its Master route matching tasks to it, Masters can delegate to it, and its chat has a `run_code` tool.

Contract: the script gets `{"task": "...", "input": "..."}` as JSON on stdin (and `TASK` in the environment) and prints its result to stdout. 30 second timeout, 64 KB output cap, minimal environment (no secrets passed).

**Security:** approval is a human gate, not a sandbox. Approved code runs as your user. Only approve code you have read. The server only accepts requests from this machine (loopback address, `Host` check, and a header that foreign websites cannot send) because it can run code. Do not expose it to a network. `ALLOW_REMOTE=1` removes those checks and is not recommended.

## Live trends for Trend Scout (optional)

Set `SEARCH_PROVIDER=brave` or `tavily` and `SEARCH_API_KEY`. Scout then searches before each scan. Without it, Scout uses the built-in October 2026 sweep. *Not tested against the live APIs.*

## Publishing to Instagram (optional, off by default)

`DRY_RUN=1` (default): the Publish button renders the slides to `data/out/<post>/` and posts nothing. Use this first.

For live posting set `DRY_RUN=0` and fill in `IG_USER_ID`, `IG_ACCESS_TOKEN`, `IG_REPO_DIR`, `IG_RAW_BASE`:

1. Instagram needs the slides at public https links. The server copies them into `IG_REPO_DIR` (a clone of a **public** GitHub repo you can push to) under `posts/<date>-<topic>/`, commits, pushes and waits for the raw links.
2. It then calls the Instagram Graph API: one media container per slide, a carousel container, a status check, then publish.
3. Prerequisites: an Instagram Business or Creator account linked to a Facebook Page, an app with `instagram_content_publish`, and a long-lived access token. Keep `.env` private; it is git-ignored.

**Not tested against a real account** (the rendering and dry run were tested; the git push and Graph API calls were written to Meta's documented flow but not run). Check `GRAPH_VERSION` against Meta's current docs. Run a dry run, then test with a throwaway post.

## Layout

```
server.js            HTTP server, API routes, security checks
src/llm.js           model providers (ollama, openai, anthropic, mock)
src/plugins.js       code integration: draft, approve, run
src/poster.js        slide rendering, GitHub hosting, Instagram Graph API
src/search.js        optional live search (brave, tavily)
src/config.js        .env loading and the approved-settings override
public/index.html    the whole UI (organization map, chats, mission, registry)
public/shim.js       connects the UI to the server and runs the model tool loop
test/smoke.mjs       server tests with the mock model
```

State: agents you create are saved in the browser (`localStorage`). Plugins, settings, rendered slides and the saved package live in `data/` (git-ignored).

## Known limits

- Agents only act while the page is open and a request is running. There is no background scheduler yet; that would be a worker process on top of the same `src/` modules.
- Agent output is text (plans, drafts, answers) unless an agent is backed by approved code.
- The UI loads fonts from Google Fonts and falls back to system fonts when offline.
