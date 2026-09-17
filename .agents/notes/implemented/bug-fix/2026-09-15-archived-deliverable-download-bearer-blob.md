# Agent Note: Authenticated blob download for archived deliverables

Status: implemented

English | [中文](2026-09-15-archived-deliverable-download-bearer-blob.zh.md)

## Problem

Multi-user Hosts require a Bearer JWT on every `/api` request. The first archived-deliverable Client used an unauthenticated `HEAD` plus bare `<a download href>` for `GET`, so Downloads returned 401 after a successful `archive_deliverable`.

## Decision

Change the archived-card Client to `GET /api/deliverable.download` with `Authorization: Bearer` from `dsh.auth.jwt` when present, buffer the response as a blob, and save through a temporary object URL. On HTTP 401, clear the stored JWT and dispatch the shared auth-expired event so the login UI can reopen. Keep Host `GET|HEAD` streaming unchanged.

## Alternatives considered

**`?access_token=` on the download URL** would let a bare `<a>` pass auth-middleware without buffering, but puts the JWT in history, logs, and Referer surfaces. Rejected for the deliverable path.

**HEAD with Bearer, then unauthenticated `<a>` GET** still fails the second request under multi-user auth. Rejected.

## Consequences

Large archives compete for tab memory. Session ZIP export still uses the older HEAD-then-`<a>` pattern and can hit the same 401 under multi-user until it adopts the same carrier.
