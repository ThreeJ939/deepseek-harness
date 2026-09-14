# Agent Note: File-upload raw route carries multi-user JWT

Status: implemented

English | [中文](2026-09-10-file-upload-jwt-auth.zh.md)

## Problem

Under `dsh-multi-user`, `auth-middleware` requires a Bearer JWT (or WebSocket `access_token`) on `/api` requests. Connection RPC and the Gateway mux attach the token from `sessionStorage['dsh.auth.jwt']`. The file-upload Client raw route (`POST /api/session/uploadFileBinary`) sent only `content-type: application/octet-stream`, so authenticated deployments returned HTTP 401 and the composer showed upload failure for every non-image attachment.

## Decision

**Attach the same stored JWT on raw file uploads.** `FileUploadRuntime.upload` builds headers with optional `Authorization: Bearer <jwt>` before the Worker or page-owned Fetch carrier runs. HTTP 401 clears the stored token and dispatches `dsh-auth-expired`, matching Connection RPC recovery. Helpers stay local to the Client runtime (same key/event names as Connection and Gateway stream client) so the Client face does not import the Host connection entry.

## Alternatives considered

**Rely on cookies / `withCredentials` alone** — rejected: the multi-user token lives in `sessionStorage`, not an HttpOnly cookie.

**Force all uploads through Typert Remote unary** — rejected: Blob progress and stream transfer require the dedicated raw route and Worker.

## Consequences

Multi-user web profiles can stage PDF and other non-image files again. Single-user profiles without a stored JWT keep the previous header set. Callers that supply `__DSH_FILE_UPLOAD__` still receive the Authorization header on the RequestInit they execute.
