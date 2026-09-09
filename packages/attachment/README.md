---
description: "Package map for the durable attachment capability family: images, documents, and where files are stored."
kind: "package-group"
---

# attachment/ — durable attachment capability family

English | [中文](README.zh.md)

## Summary

The `attachment/` group provides durable image and document attachments: attach images or documents to prompts and commands, and the harness saves them, shows images again in conversation history, injects extracted document text into the user message, and sends the resulting content to the model in later turns. The shipped `dsh` composition enables this with no setup. The capability and its storage are split across packages, described below. Stored attachments survive restarts and are never deleted automatically.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

These packages provide durable attachments; each README describes what you can do with its part.

| Package | Role | ctx key |
|---|---|---|
| [`attachment/`](attachment/README.md) | Image and document attachments for prompts and commands that persist and come back in history | `ctx.attachments` |
| [`attachment-local/`](attachment-local/README.md) | Stores your attached files on this machine below `DSH_HOME` | registers on `ctx.attachments` |
| [`attachment-s3/`](attachment-s3/README.md) | Stores your attached files in an S3-compatible bucket | registers on `ctx.attachments` |
| [`attachment-document/`](attachment-document/README.md) | Extracts plain text from admitted documents for prompt injection | library (no ctx key) |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the service contract, then the capability-seam table and the configuration surface of the local backend.

- [Attachment subsystem reference](../../docs/subsystems/attachment.md) — service contract, payload types, and the `ctx.attachments` cordis surface.
- [Capability seams](../../docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this family follows.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-attachment-local) — every accepted field of the local backend.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
