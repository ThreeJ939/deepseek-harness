# @deepseek-ai/dsh-host-auth-login

English | [中文](README.zh.md)

Token-exchange endpoint for multi-user dsh. `POST /api/auth.exchange` calls the configured SaaS userinfo endpoint and signs an HS256 JWT for the requesting browser client.

No invariant companion is published because the exchange endpoint is a stateless HTTP handler registered at plugin init time with no durable registry relationship to assert.

## Model Experience

None; this package only authenticates browsers before Host APIs are used.

## Known Limitations and Deferred Work

- **HS256 only** — asymmetric or multi-issuer setups need a follow-on provider.
