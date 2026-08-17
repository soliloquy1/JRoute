# JRoute
### Break the chains — For real this time.
**No company. No filters. No catch.**

A self-hosted reverse proxy for [JanitorAI](https://janitorai.com).

For the full setup guide, see [the docs](https://soliloquy.gitbook.io/jroute).

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

## Why JRoute?

**Your roleplay** — no overhead, no compromises. More features, 
full privacy, fully open source.

**The full roleplay experience**, on any frontend — JanitorAI included.

No other reverse proxy lets you port your **full SillyTavern setup** — rich presets, ST-style regex post-processing, 
logit bias — into one place, with auto-routing across every provider you use. Not JanitorAI itself. 
Not even the big closed-source proxies with their special plugins.

**JRoute doesn't snoop. It's private. It's entirely yours.**

## Disclaimer

JRoute is a routing tool — it forwards requests to whatever providers you configure, exactly
as configured by you. It doesn't modify, bypass, or circumvent anyone's terms of service,
rate limits, or content policies.

You're responsible for complying with the terms of service of JanitorAI, every LLM provider
you connect, and any other frontend you use JRoute with. This project doesn't endorse or
encourage violating any of them.

JRoute is an independent, community project and is not affiliated with, endorsed by, or
sponsored by JanitorAI, any LLM provider, or any other frontend or company named in this
document or in app.

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
