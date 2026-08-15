# JRoute

A self-hosted reverse proxy for [JanitorAI](https://janitorai.com).

JRoute exposes an OpenAI-compatible endpoint that Janitor's frontend calls directly,
forwards requests to whichever LLM provider you configure, and adds three things Janitor
cannot do on its own:

- **Custom prompt assembly** — inject your own system blocks around the character card
  without editing anything inside Janitor, with per-key presets.
- **Lorebooks** — JavaScript you write yourself, executed in a sandbox on every message,
  injecting context at a controlled depth in the conversation.
- **MCP tools** — server-side tool execution, web search above all. Janitor has no MCP
  client, so JRoute runs the tool loop itself and returns one clean answer.

> **Status: under construction.** The foundation is being built now. Nothing here is
> usable yet.

## Why a fork

JRoute began as a fork of [OmniRoute](https://github.com/diegosouzapw/OmniRoute), a
general-purpose AI router supporting ~300 providers with 19 routing strategies, context
compression, agent protocols, and a 55-page dashboard.

That is a great deal more than a JanitorAI proxy needs. JRoute keeps the parts that serve
one use case — a handful of API-key and OAuth providers with flat priority fallback — and
drops the routing intelligence and compression entirely. Roughly 707k lines of TypeScript
became a target of 20–25k.

## Requirements

- **Node.js 22 LTS is recommended** (and required for Windows). `jroute` uses the native
  `better-sqlite3` module; its prebuilt binary is most reliably available on Node 22 LTS, so
  Windows users in particular should install Node 22 LTS rather than Node 24.
- Supported range: `>=22.0.0 <23` or `>=24.0.0 <27` (a working `better-sqlite3` prebuild is
  needed for your Node version; if `npm install` cannot fetch one and no build tools are
  present, install Node 22 LTS or add the C++ build tools).
- An API key from at least one LLM provider

## License

MIT. JRoute is derived from OmniRoute, which is also MIT; both copyright notices are
retained in [LICENSE](LICENSE), as that license requires.
