# Agent Note: Admit BMP on the image attachment path

Status: implemented

English | [中文](2026-09-10-image-bmp-admission.zh.md)

## Problem

Windows screenshot and paint workflows often produce `image/bmp`. The composer image path only accepted `png|jpeg|webp|gif`, so BMP uploads soft-routed to the verbatim file path and never reached vision models as pixels.

## Decision

**Widen `ImageMediaType` with `image/bmp`.** Local and S3 attachment stores list BMP in `mediaTypes`; sharp detection maps `bmp`; normalization excludes BMP from byte-identical pass-through (same treatment as GIF) and skips alpha verification for BMP sources. Client `createDrafts` / MIME validation, `read_image` extension sniffing, session-log export extensions, LLM handle text, and DeepSeek Files API filename extensions follow the closed union.

## Alternatives considered

**Keep BMP on the file path only** — rejected: screenshots must enter the vision request path, not handle-text projection.

**Sniff empty MIME as image by magic bytes in the browser** — deferred; browser-declared `image/bmp` covers the common screenshot case without a second client decode path.

## Consequences

Deployments that mount `attachment-local` or `attachment-s3` accept BMP on prompt admission without config changes. Request projection still re-encodes BMP into jpeg/webp (or S3 WebP) before the model call.
