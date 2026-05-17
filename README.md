# Flat Web

Web-based shared-flat app focused on `Finanzen` and `Aufgaben`.

## Development

```bash
bun install
bun run dev
```

Local secrets live in `.dev.vars`. Roommates are configured in `src/shared/config.ts`.

Example `.dev.vars` for local development:

```bash
MAGIC_PASSWORD="flatastic"
SESSION_SECRET="dev-secret-change-before-deploy"
```

## D1

Apply migrations locally:

```bash
bun run db:migrate:local
```

Create the production D1 database:

```bash
bunx wrangler d1 create flat-web
```

Then replace the generated `database_id` in `wrangler.toml` and run:

```bash
bun run db:migrate:remote
bunx wrangler secret put MAGIC_PASSWORD
bunx wrangler secret put SESSION_SECRET
bun run deploy
```

If plaintext variables with the same names already exist in Cloudflare, remove them from `wrangler.toml`, deploy once, then create the secrets.

## Workers AI

Receipt analysis uses the Workers AI binding configured in `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

The receipt parser currently uses `@cf/meta/llama-3.2-11b-vision-instruct`.
Before first production use, accept Meta's model terms from the Cloudflare account that owns the Worker:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/meta/llama-3.2-11b-vision-instruct" \
  -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"prompt":"agree"}'
```

## Checks

```bash
bun run typecheck
bun run test
bun run test:e2e
bun run build
```
