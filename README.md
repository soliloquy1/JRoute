# JRoute

A self-hosted reverse proxy for [JanitorAI](https://janitorai.com).

JRoute exposes an OpenAI-compatible endpoint that Janitor's frontend calls directly,
forwards requests to whichever LLM provider you configure, and adds three things Janitor
cannot do on its own:

- **Multi-provider routing with automatic fallback** — connect any number of API-key or
  OAuth-based providers. JRoute fails over between them automatically when one is rate
  limited, over quota, or down, with a configurable fallback strategy and per-connection
  quota tracking.
- **A prompt pipeline JanitorAI doesn't have** — SillyTavern-style rich presets (full
  Prompt Manager import, sampler overrides, macros), lorebooks, logit bias presets, regex
  find/replace presets (applied to both the outgoing message and the streaming reply,
  without breaking the stream), and reasoning-tag stripping (hides a model's
  `<think>...</think>`-style internal planning text from the final reply — even when the
  model never emits the opening tag).
- **Operational visibility** — a dashboard for managing keys, connections, and presets,
  plus per-provider usage analytics, so you can see what's actually happening across every
  connection instead of guessing from Janitor's own error messages.

For the full setup guide, see [the docs](https://soliloquy.gitbook.io/jroute).

## Installing

The easiest way to get started is the [one-click installer](https://github.com/soliloquy1/JRoute/releases)
(Windows, macOS, Linux) — it downloads a pinned Node.js runtime, builds JRoute, and runs it
locally, with no manual setup. Point Janitor's custom endpoint at the local address it
gives you and you're done.

To run from source instead:

```bash
git clone https://github.com/soliloquy1/JRoute.git
cd JRoute
npm install
npm run dev
```

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
