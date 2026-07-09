# Danets AI Automation

Multi-tenant SaaS platform for AI-powered website chat, lead capture, CRM, quotes, and platform operations — by **Danets TecPro Limited**.

## Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router), TypeScript 5 |
| UI | Tailwind CSS 4, shadcn/ui, Recharts |
| Database | **MySQL 8** + Prisma (46 models) |
| Auth | Custom sessions — tenant (`danets_session`) + platform (`danets_platform_session`) |
| AI | OpenAI via `src/lib/ai.ts` |
| Payments | Paystack / Flutterwave |
| Email | SMTP (Nodemailer) / SendGrid |
| Tests | Vitest (unit) + Playwright (smoke) |

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
| `npm run test:e2e` | Playwright smoke (server must be running) |
| `npm run db:seed` | Seed database |
| `npm run db:migrate` | Apply migrations (dev) |

## Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) — production setup, env vars, CI, cron, troubleshooting
- [worklog.md](./worklog.md) — development history and conventions

## License

Private — Danets TecPro Limited.
