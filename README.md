# Keyless Relay

A company puts its provider API keys (Claude, Codex/OpenAI, GitHub, Railway) in **one relay**. Everyone and
everything else gets an **ENS name** instead of a key. A name's text records (its "bundle") say which providers
it may use and how many dollars it may spend. Names form a tree on ENSv2 (Sepolia):

```
acme.eth                              company       holds the rules for everyone
└─ eng.acme.eth                       member        department or person
   └─ derek.eng.acme.eth              member
      └─ laptop.derek.eng.acme.eth    agent session owned by the agent's key, expires on its own
```

Nothing below can widen what's above, removing a name cuts off everything under it, and a session ends when its
name expires. The relay holds the keys but can't change any rule; only the level above a name can.

> The ENSv2 contracts are **not final**. Addresses and ABIs are pinned to `ensdomains/contracts-v2@71a3b73`
> on Sepolia, the deployment the [ENS docs](https://docs.ens.domains/ensv2/overview) list.

## Run it

```bash
npm install
cp .env.example .env.local     # then fill in what you need (every setting is explained there)
npm run dev                    # admin app: http://localhost:3000   raw ENSv2 tools: /playground
```

The smallest useful `.env.local`:

```bash
RELAY_ROOT_NAME=acme.eth               # your company's .eth name (required for relaying)
RELAY_ROOT_OWNER=0x...                 # the wallet that owns it (recommended)
ANTHROPIC_API_KEY=sk-ant-...           # any of these; the "mock" provider needs none
OPENAI_API_KEY=sk-...
GITHUB_TOKEN=github_pat_...            # fine-grained PAT
RAILWAY_TOKEN=...                      # project token
RELAY_ADMIN_TOKEN=...                  # openssl rand -hex 32; needed before others can reach the relay
```

Restart `npm run dev` after changing it. You need a browser wallet on Sepolia with a little Sepolia ETH;
registration fees are paid in test USDC, which the page mints for free.

## Admin app (`/`)

Work top to bottom with the company owner's wallet:

1. **Company setup**: register the name (if needed), deploy your resolver, point the name at it, write the
   company limits, allow people to be added.
2. **Team tree**: click a name to add a member, start an agent session (15 min / 1 h / 8 h), edit limits,
   extend or remove it, copy an agent's access token.
3. **Plans**, **Delegates** (someone may change one cap and nothing else), **Session Minter** (one-transaction
   sessions), **Try a call** with the relay log, and **Company domain** (DNS alias).

When `RELAY_ADMIN_TOKEN` is set, sign in at `/api/relay/admin` to see spend and the log in the app.

## The relay

| Endpoint | What it does |
|---|---|
| `ANY /api/relay/<claude\|codex\|github\|railway\|mock>/<path>` | Forwards to the provider with the real key. Needs an agent token (`kr1.…`) in `x-api-key` or `Authorization: Bearer`. |
| `GET /api/relay/status` | The setup (never key values). |
| `GET /api/relay/policy?name=&provider=` | What the relay would decide right now, with spend per level. |
| `GET /api/relay/log?limit=` | Recent decisions, newest first. |
| `GET /api/ens/children?name=` | Names registered directly under a name. |

`/policy` and `/log` need the admin token (or the sign-in cookie) or an agent token for that name; they are open
only in development without `RELAY_ADMIN_TOKEN`. Run **one** relay process per data directory: spend is kept in
that process and in `.data/relay.json`.

Point tools at it with an agent token as the API key:

```bash
ANTHROPIC_BASE_URL=http://localhost:3000/api/relay/claude  ANTHROPIC_API_KEY=<token>  claude
OPENAI_BASE_URL=http://localhost:3000/api/relay/codex/v1   OPENAI_API_KEY=<token>     codex
curl http://localhost:3000/api/relay/mock/v1/messages -H "x-api-key: <token>" -H "content-type: application/json" \
  -d '{"model":"mock","max_tokens":64,"messages":[{"role":"user","content":"Hello"}]}'
```

## Agent CLI

An agent that keeps its own key (instead of one generated in the browser):

```bash
npm run agent -- new                                   # creates .keyless/agent.json, prints the address
# paste that address into "Start an agent session" in the admin app, then:
npm run agent -- policy --name laptop.derek.eng.acme.eth --provider mock
npm run agent -- call   --name laptop.derek.eng.acme.eth --provider mock
eval "$(npm run -s agent -- env --name laptop.derek.eng.acme.eth)"   # sets the Claude Code / Codex variables
npm run agent -- primary-name --name laptop.derek.eng.acme.eth       # the key needs a little Sepolia ETH
```

Options: `--relay` (or `KEYLESS_RELAY_URL`, default `http://localhost:3000/api/relay`), `--rpc`, `--key`.
Run `npm run agent` for the full help.

## Checks

```bash
npm test                                   # unit tests (node:test)
npx tsc --noEmit && npx eslint .
npm run demo:fork                          # full end-to-end run on a local Sepolia fork (needs anvil)
```

`npm run demo:fork` builds a company, a member and agent sessions on a fork of Sepolia with the real ENSv2
contracts, then checks caps, revocation, expiry, aliasing, fake resolvers, token revocation and the CLI against
the real route handlers. It reuses an anvil on `FORK_PORT` (default 8602) or starts one from `ANVIL_BIN`,
`~/.foundry/bin/anvil` or `anvil` on your PATH. If the public RPC rate-limits, set
`FORK_URL=https://sepolia.gateway.tenderly.co`.

The optional SessionMinter contract lives in [`contracts/`](contracts/README.md) (Foundry; run
`git submodule update --init` once after cloning).

## Layout

```
app/page.tsx, app/_components/   Admin app
app/playground/                  Raw ENSv2 playground (register, records, subnames, access control)
app/api/relay/, app/api/ens/     Relay routes
lib/relay/                       Relay server (policy, chain reader, meter, providers) and shared helpers
lib/ens/                         ENSv2 helpers: addresses, ABIs, roles, names, factory, hierarchy
lib/hooks/                       React hooks
scripts/agent.ts                 Agent CLI
scripts/fork-demo.ts             End-to-end demo on a Sepolia fork
contracts/                       SessionMinter (Foundry)
```
