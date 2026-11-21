# Danets AI Automation

Multi-tenant SaaS platform for AI-powered website chat, lead capture, CRM, quotes, and platform operations — by **Danets TecPro Limited**.

## Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router), TypeScript 5 |
| UI | Tailwind CSS 4, shadcn/ui, Recharts |
| Database | **MySQL 8** + Prisma (46 models) |
| Auth | Custom sessions — tenant (`danets_session`) + platform (`danets_platform_session`) |
| AI | Anthropic Claude (default), OpenAI or z-ai via `src/lib/llm` |
| Payments | Paystack / Flutterwave |
| Email | SMTP (Nodemailer) / SendGrid |
| Background jobs | MySQL-backed queue (`src/lib/jobs`), drained by `npm run worker` or `/api/cron/jobs` |
| Tests | Vitest (unit + opt-in MySQL) + Playwright (e2e) |

## Quick start

```bash
npm install
cp .env.example .env
# Edit DATABASE_URL and secrets

npx prisma migrate dev
npm run db:seed
npm run dev
```

- **Tenant app:** http://localhost:3000  
- **Platform console:** http://localhost:3000/platform  

### Demo credentials (after seed)

| Realm | Email | Password |
|-------|-------|----------|
| Tenant | `admin@danetstecpro.com` | `danets123` |
| Platform | `superadmin@danetstecpro.com` | `super123` |

## AI providers

All AI calls go through `src/lib/llm` (`aiChat`, `aiStream`, `aiStructured`). Call sites name a **task** (`chat`, `classify`, `extract`, `content`, `plan`), never a model; the resolver picks the provider and model.

- **Platform default:** set `ANTHROPIC_API_KEY` to use Claude (`claude-opus-5-5` for every task unless overridden with `AI_DEFAULT_MODEL` or `AI_MODEL_<TASK>`). `AI_DEFAULT_PROVIDER` forces `anthropic`, `openai` (needs `OPENAI_API_KEY` + `OPENAI_DEFAULT_MODEL`) or `zai` (legacy fallback when nothing else is configured).
- **Per tenant:** an active **AI provider** integration (Integrations page) overrides the platform default for that tenant.
- **Usage and cost:** every call is logged to `AiUsageLog` with provider, model, tokens (including prompt-cache reads/writes) and per-model cost.
- **Brand voice:** content generators must include `getBrandContext(businessId)` from `src/lib/brand.ts` in their system prompt.

See `.env.example` for every AI variable.

## Project structure

```
src/
  app/                    # Next.js routes (tenant /, platform /platform, APIs)
  components/dashboard/   # Tenant SPA views + shell
  lib/                    # Auth, quotas, payments, email, module registry
prisma/                   # Schema + migrations
scripts/seed.ts           # Plans, demo tenant, platform admin
tests/                    # Vitest + Playwright
```

## Key features

- **Tenant dashboard** — 17 modules (leads CRM, tickets, quotes, documents, WhatsApp, automations, analytics, etc.)
- **Platform console** — tenant management, billing, health scores, retention, feature flags
- **Enforcement** — subscription status → plan modules → numeric quotas
- **Public widget** — `GET /widget.js?pk=<publicKey>` embeddable chat + lead capture
- **2FA** — optional TOTP for tenants; enforceable TOTP for platform admins

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server (port 3000) |
| `npm run build` | Production build |
| `npm start` | Run standalone server |
| `npm test` | Unit tests |
| `npm run test:e2e` | Playwright smoke + attribution e2e (server must be running) |
| `npm run test:db` | Queue and contact tests against MySQL (needs `JOBS_TEST_DATABASE_URL`) |
| `npm run worker` | Background job worker (run next to `npm start`) |
| `npm run contacts:backfill` | Link existing leads/chats/tickets to Contacts (safe to re-run) |
| `npm run db:seed` | Seed database |
| `npm run db:migrate` | Apply migrations (dev) |

## Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) — production setup, env vars, CI, cron, troubleshooting
- [worklog.md](./worklog.md) — development history and conventions

## License

Private — Danets TecPro Limited.
