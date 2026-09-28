---
description: "Near-identity Session V4-to-V5 migration: optional ownerUserId header admission with unchanged event bodies."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

English | [中文](README.zh.md)

## Summary

Restore supported released V4 Sessions as V5 without rewriting their stored generation. This edge advances the header version and admits optional `ownerUserId`; event bodies, runs, coordinates, and inherited cuts pass through unchanged. Persistence owns file reads and successor publication; this library owns conversion and target rules.

## Table of Contents

- [Use this package](#use-this-package)
- [V4-to-V5 specification](#v4-to-v5-specification)
  - [Header and physical framing](#header-and-framing)
  - [Event and run pass-through](#event-passthrough)
  - [Delivery generations](#delivery-guards)
  - [Source audit and refusal](#source-audit)
- [Native V5 admission](#native-v5-admission)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use the [catalog](../session-format-catalog/README.md) for complete restoration. Direct imports serve catalog assembly and tests; this library has no Cordis mount configuration. Its [public exports](src/index.ts) provide the adjacent migration, the released V4 source codec, the V5 codec, and target validators. The source codec remains owned by [V3-to-V4](../session-format-v3-to-v4/README.md).

Header-only migration validates and advances metadata without reading the body:

```text
const targetHeader = sessionFormatV4ToV5.migrateHeader(sourceHeader)
```

Body restoration creates independent Stage state per artifact. Compact runs expand as iterables without an intermediate event array. The [format protocol](../session-format/README.md) owns scheduling and error handling; [JSONL persistence](../session-persistence-jsonl/README.md) owns source reads, preparation, and verified exclusive successor publication.

-----

<a id="v4-to-v5-specification"></a>
## V4-to-V5 specification

This edge changes only the header version field and does not transform event payloads, message identities, coordinates, or catalog facts. Earlier V0–V3 inputs first pass through their existing edges to V4; those edges retain their own transformations and refusal policies.

<a id="header-and-framing"></a>
### Header and physical framing

| Input | V5 result | Preservation or refusal |
|---|---|---|
| Logical V4 header | `version: 4` becomes `5` | Released V4 header validation runs first; all other logical header fields remain unchanged. Released V4 headers do not carry `ownerUserId`. |
| V4 physical rows | Released V4 source codec decodes events and compact runs | Source framing and source-event range decoding remain owned by the preceding package. |
| V5 physical rows | `releasedV5SessionFormatCodec` reuses released V4 framing with native V5 header admission | Encoding and decoding do not run this incoming migration. |

<a id="event-passthrough"></a>
### Event and run pass-through

Every admitted source event is emitted with its original object identity, `seq`, `time`, `type`, `data`, and optional envelope fields. Compact runs expand only when the stage has no direct run handler; values remain unchanged. Inherited cuts stay numerically identical under identity conversion. Sparse source sequences refuse.

<a id="delivery-guards"></a>
### Delivery generations

A V4 source delivery marker that claims `sessionFormatVersion: 5` refuses before emission. Predecessor and unrelated generation markers pass through unchanged. Native V5 restoration activates only markers whose `sessionFormatVersion` equals `5`.

<a id="source-audit"></a>
### Source audit and refusal

| Source condition | Result |
|---|---|
| Released V4 header with unexpected members | Format error before migration |
| Sparse event sequences | Format error |
| Unseeded log with inherited end-seed | Format error |
| Seeded cut disagreeing with the final inherited marker | Format error |
| Delivery marker claiming target V5 | Unsupported migration refusal |

Unknown required or ignorable event vocabulary remains owned by released V4 restoration and the installed Session package after the header advances.

-----

<a id="native-v5-admission"></a>
## Native V5 admission

Native V5 headers require the released V4 fields and optionally admit nonempty string `ownerUserId`. Empty or non-string owner ids refuse. Event-body admission, lifecycle relationships, and retired syntax reuse the released V4 validators; current-generation delivery markers activate only at version `5`.

`assertReleasedV5Header` validates logical metadata. `restoreReleasedV5Artifact` validates inheritance, vocabulary, V4 body rules, and V5 delivery ownership. `releasedV5SessionFormatCodec` encodes and decodes physical rows with the optional owner field on the header only.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/migration.ts`](src/migration.ts) owns the adjacent declaration and identity stage. [`src/codec.ts`](src/codec.ts) wraps the released V4 codec while restoring `ownerUserId` on logical headers. [`src/validation.ts`](src/validation.ts) owns V5 header and delivery checks and reuses released V4 body validators.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session format catalog](../session-format-catalog/README.md)
- [V3-to-V4 specification](../session-format-v3-to-v4/README.md)
- [Adding a Session format version](../../../docs/cookbook/adding-a-session-format-version.md)

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

This edge does not rename events, rewrite tool results, or complete parent catalogs. Structural body changes require a later adjacent version. Historical V4 archives remain without `ownerUserId`; only native V5 writers stamp that field.

<a id="dev-note"></a>
## Dev Note

None.
