# @deepseek-ai/dsh-client-ui-auth

English | [中文](README.zh.md)

Multi-user login UI plugin. The Host half publishes OAuth and JWT-paste options into the index HTML; the browser half registers a mandatory modal gate over the layout root.

No invariant companion is published because the plugin owns one slot registration released by its effect disposer; no second authority exists to check at runtime.

## Model Experience

None; this package only gates browser access before chat.

## Known Limitations and Deferred Work

- **JWT paste is test-oriented** — production deployments should rely on OAuth PKCE when endpoints are configured.
