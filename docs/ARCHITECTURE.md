# Architecture & Design

**Stack:** TypeScript / Node.js CLI + PostgreSQL

**Design philosophy:** a lean crawler that still handles the hard cases. Every component earns its place against a concrete requirement; anything not needed for the core is listed as a deliberate production extension rather than built.

---

## 1. What it does

A CLI crawler that takes a seed URL, discovers in-scope links, fetches **all** content through the external Fetch API, persists files by type together with their metadata, and keeps **durable, resumable, concurrency-safe** crawl state in PostgreSQL. It is a small durable task-processing system, not a script.

```bash
npm run crawl -- --seed=http://www.example.com/en --concurrency=5
```

Core loop:

```
seed URL → crawl_run + first queued task
  → worker pool claims tasks (FOR UPDATE SKIP LOCKED)
  → FetchClient calls the Fetch API
  → response classified by status + Content-Type
  → content handler persists file + metadata
  → HTML handler discovers links → normalize → scope check → enqueue (ON CONFLICT DO NOTHING)
  → repeat until frontier drained AND no work in flight
```

---

## 2. Scope: implemented vs. deliberately deferred

### Implemented
- Seed URL intake, scope derivation, durable frontier in Postgres.
- Concurrency-safe claiming; each URL processed at most once.
- Four content types downloaded + processed: HTML, image, video, PDF.
- Metadata per type (title/link count, dimensions/size, size/duration, pages/title).
- Clean separation of permanent vs. transient failures (404/403 vs 429/500/network/null-body).
- Retry with backoff + jitter, `Retry-After` handling, global rate reaction to 429.
- Resumability after crash/interrupt (stale `in_progress` recovery).
- Safety limits (max URLs/depth/bytes/runtime).
- Structured logs + `status` command + inspectable DB.
- Focused unit + integration tests (mock fetch).

### Deliberately deferred (production extensions)
robots.txt, sitemaps, `rel=canonical` merging, JS rendering, distributed workers, a dedicated queue (Kafka/SQS/RabbitMQ), Redis rate limiter, object storage, metrics/tracing stack, web dashboard, full content-dedup enforcement, a `crawl_events` audit table.

---

## 3. Architecture

```mermaid
flowchart TD
    CLI[CLI: crawl / status] --> RS[CrawlRunService]
    RS --> PG[(PostgreSQL)]
    PG --> WP[Worker Pool]
    WP --> RL[RateLimiter]
    WP --> FC[FetchClient]
    FC --> API[External Fetch API]
    FC --> CL[Response Classifier]
    CL --> HR[HandlerRegistry]
    HR --> H1[HTML] & H2[Image] & H3[Video] & H4[PDF]
    H1 --> DISC[Discovery: normalize + scope]
    DISC --> PG
    H1 --> OUT[OutputStorage] & H2 --> OUT & H3 --> OUT & H4 --> OUT
    OUT --> FS[output/*]
    HR --> PG
    WP --> LOG[Structured logs / status]
```

| Component | Single responsibility |
|---|---|
| `CrawlRunService` | Create/resume run, derive scope, seed frontier, recover stale tasks, finalize run status. |
| `FrontierRepository` | Durable queue: enqueue, concurrency-safe claim, mark outcome, recover stale, termination checks. |
| `FetchClient` | Adapter over Fetch API. `HttpFetchClient` + `MockFetchClient`. Normalizes `body` to `Buffer`. |
| `ResponseClassifier` | Maps (status, headers, body) → action (process / retry / permanent / blocked / skip). |
| `RetryPolicy` | Retryability + next-attempt time (backoff, jitter, `Retry-After`). |
| `RateLimiter` | Paces requests; global pause/slowdown on 429. |
| `HandlerRegistry` + `ContentHandler`s | Content-type-dispatched processing. Adding a 5th type = add one handler. |
| `UrlNormalizer` / `ScopePolicy` | Canonical URL + in/out-of-scope decision. |
| `OutputStorage` | Deterministic hash-based file paths per type. |

---

## 4. Key design decisions

**D1 — Postgres as both store and frontier.** Row-level locking (`FOR UPDATE SKIP LOCKED`) gives safe concurrent claiming; uniqueness gives dedup; a durable table gives resumability and inspectability. A dedicated queue earns its place only when fetch/processing workers scale horizontally, so no Redis/SQS/Kafka here.

**D2 — Scope = registrable domain by default, configurable.** The task is to stay within the seed's domain. "Domain" is interpreted as the registrable domain (eTLD+1), so `www.example.com` and `example.com` are treated as the same site; subdomains are included. This avoids the failure mode where exact-hostname scoping silently crawls almost nothing because a site links to its apex. Policy is pluggable: `registrable-domain` (default), `exact-hostname`, `subdomain-allowlist`.

**D3 — Content-Type is the source of truth, never the URL extension.** The extension only informs the output file suffix *after* the type is decided from `Content-Type`. A missing/unsupported type becomes `skipped_unsupported` — recorded, not crashed.

**D4 — Fetch success ≠ metadata success.** If bytes are fetched and persisted, the URL is `done` even if metadata extraction (e.g. a PDF parse) fails; the failure is recorded on the content row (`metadata_status`, `metadata_error`). This models real crawlers correctly.

**D5 — Extensibility via handler registry.** The crawler core never branches on content type; it asks the registry for a handler. Adding a type means implementing a handler, registering it, and mapping an extension — no core changes.

**D6 — Termination waits for in-flight work.** A worker stops only when there is no claimable task, no retry due in the future, **and no task is `in_progress`**. This closes the race where a worker exits while another is still parsing HTML that will enqueue new URLs.

**D7 — Best-effort binary/duration.** `body` is normalized to `Buffer` regardless of transport encoding (string/base64/Buffer) — see D8. Video duration is best-effort (`null` allowed); file size is always stored.

**D8 — Robust, configurable `body` decoding.** `FetchClient` normalizes every Fetch API body to `Buffer | null` with `auto` as the default strategy. In `auto`, textual `Content-Type`s (`text/*`, JSON, XML, XHTML, JavaScript) decode strings as UTF-8; otherwise strings that strictly look like base64 are decoded as base64; otherwise strings fall back to UTF-8. The strategy can be overridden with `FETCH_BODY_STRATEGY` or `--body-strategy` (`auto | base64 | utf8`). Residual ambiguity is explicit: a string that accidentally is valid base64 with a binary or missing `Content-Type` is decoded as base64, but the override exists for that case.

**No homepage fallback.** A 404 on the seed is a user-selected URL failing, not permission to silently crawl a different URL.

---

## 5. Data model (4 tables)

Design goal: reflect the problem without column bloat. A `crawl_events` audit table is intentionally omitted (structured logs cover audit).

### `crawl_runs`
```sql
CREATE TABLE crawl_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_url            TEXT NOT NULL,
  normalized_seed_url TEXT NOT NULL,
  scope_host          TEXT NOT NULL,               -- registrable domain (or host, per policy)
  scope_policy        TEXT NOT NULL DEFAULT 'registrable_domain',
  status              TEXT NOT NULL DEFAULT 'running',
  max_urls            INTEGER,
  max_depth           INTEGER,
  max_bytes           BIGINT,
  max_runtime_seconds INTEGER,
  concurrency         INTEGER NOT NULL DEFAULT 5,
  total_bytes         BIGINT NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Run statuses: `running`, `completed`, `completed_with_failures`, `limit_reached`, `failed`, `cancelled`.

### `crawl_urls` (the frontier + per-URL state)
```sql
CREATE TABLE crawl_urls (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_run_id           UUID NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  url                    TEXT NOT NULL,
  normalized_url         TEXT NOT NULL,
  url_hash               TEXT NOT NULL,             -- for file naming
  host                   TEXT NOT NULL,
  depth                  INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'queued',
  http_status_code       INTEGER,
  content_type           TEXT,
  attempt_count          INTEGER NOT NULL DEFAULT 0,
  max_attempts           INTEGER NOT NULL DEFAULT 5,
  next_attempt_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error             TEXT,
  last_error_type        TEXT,
  discovered_from_url_id UUID REFERENCES crawl_urls(id),  -- cheap discovery tree
  claimed_at             TIMESTAMPTZ,
  finished_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX crawl_urls_dedup
  ON crawl_urls (crawl_run_id, normalized_url);
CREATE INDEX crawl_urls_claim
  ON crawl_urls (crawl_run_id, status, next_attempt_at, created_at);
```
URL statuses: `queued`, `in_progress`, `done`, `retryable_failed`, `permanent_failed`, `blocked`, `skipped_unsupported`. Out-of-scope URLs are not stored here — they are recorded only as edges (below).

### `contents`
```sql
CREATE TABLE contents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_url_id    UUID NOT NULL UNIQUE REFERENCES crawl_urls(id) ON DELETE CASCADE,
  crawl_run_id    UUID NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,                    -- html | image | video | pdf
  content_type    TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  byte_size       BIGINT NOT NULL,
  content_hash    TEXT NOT NULL,                    -- sha256 of bytes: change detection + dedup signal
  etag            TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  metadata_status TEXT NOT NULL DEFAULT 'ok',       -- ok | partial | failed
  metadata_error  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contents_hash ON contents (content_hash);
```
`metadata` is JSONB so a 5th type needs no schema change. `content_hash` is stored for change detection; the implementation does **not** enforce cross-URL file dedup (documented trade-off).

### `url_edges` (discovery graph)
```sql
CREATE TABLE url_edges (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_run_id              UUID NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  from_url_id               UUID NOT NULL REFERENCES crawl_urls(id) ON DELETE CASCADE,
  to_url_id                 UUID REFERENCES crawl_urls(id) ON DELETE CASCADE,  -- null if out-of-scope
  discovered_url            TEXT NOT NULL,
  normalized_discovered_url TEXT,
  in_scope                  BOOLEAN NOT NULL,
  source                    TEXT,                   -- a.href | img.src | source.src | ...
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX url_edges_from ON url_edges (from_url_id);
```
Records discovery relationships and lets out-of-scope links be captured without polluting `crawl_urls`.

No `domains` table: one seed → one fixed scope per run, so the host lives as an attribute. A `domains` entity would earn its place only for multi-domain crawling, per-domain politeness, and robots.txt state.

---

## 6. Concurrency & the frontier

Claim + mark in a single transaction:
```sql
-- claim
SELECT * FROM crawl_urls
WHERE crawl_run_id = $1
  AND status IN ('queued', 'retryable_failed')
  AND next_attempt_at <= now()
ORDER BY created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;
-- then, same tx:
UPDATE crawl_urls
SET status = 'in_progress', claimed_at = now(), updated_at = now()
WHERE id = $claimed;
```
Enqueue is idempotent:
```sql
INSERT INTO crawl_urls (crawl_run_id, url, normalized_url, url_hash, host, depth, status, discovered_from_url_id)
VALUES ($1,$2,$3,$4,$5,$6,'queued',$7)
ON CONFLICT (crawl_run_id, normalized_url) DO NOTHING
RETURNING id;
```
The unique index makes "process at most once" a database guarantee, safe under crashes, concurrency, and resume.

---

## 7. Fetch handling

### Status → action
| Status | Action | Terminal status |
|---|---|---|
| 200 + supported body | process | `done` |
| 200 + null/empty body | retry (unreliable API) | `retryable_failed` |
| 200 + unsupported Content-Type | record, skip | `skipped_unsupported` |
| 404 | no retry | `permanent_failed` |
| 403 | no retry (default) | `blocked` |
| 429 | respect `Retry-After`, global pause, retry | `retryable_failed` |
| 500 / network error | backoff retry | `retryable_failed` |

### Headers (case-insensitive)
`Content-Type` → handler; `Content-Length` → sanity-check vs body length; `Retry-After` → 429 scheduling (parses both delta-seconds and HTTP-date); `ETag` → stored for future conditional fetch; `Location` → relevant only if a 3xx appears (see below).

### Redirects
The defined status set has no 3xx. Generic `3xx` is handled if observed: when `statusCode` is in [300,400) with `Location` present, the target is normalized, scope-checked, followed up to a bounded depth, and recorded as an edge.

---

## 8. Retry & rate limiting

```ts
const retry = { maxAttempts: 5, baseDelayMs: 5_000, maxDelayMs: 300_000, jitterRatio: 0.25 };
// delay = min(base * 2^(attempt-1), max);  apply ±jitterRatio
// 429: prefer Retry-After (seconds or HTTP-date); else backoff; also notify the limiter.
```
RateLimiter: fixed concurrency + a small inter-request delay. On 429 it reads `Retry-After` and **globally pauses** all workers until it elapses, then resumes, because the Fetch API is the shared bottleneck. Token buckets / per-domain / distributed limiting are production extensions.

---

## 9. Content handlers

```ts
interface ContentHandler {
  readonly kind: 'html' | 'image' | 'video' | 'pdf';
  supports(contentType: string): boolean;
  process(input: ProcessInput): Promise<ProcessResult>; // file + metadata (+ links for HTML)
}
```
The registry finds the first handler whose `supports()` matches the normalized `Content-Type`.

| Handler | Persist | Metadata | Notes |
|---|---|---|---|
| HTML (`cheerio`) | raw HTML | `{ title, discoveredLinkCount }` | count = all discovered links; in/out-of-scope split lives in `url_edges`. |
| Image (`image-size`) | bytes | `{ width, height, fileSize }` | dims fail → save + `partial`. |
| Video | bytes | `{ fileSize, durationSeconds\|null }` | duration via optional `ffprobe`; null is acceptable. |
| PDF (`pdf-parse`) | bytes | `{ pageCount, title? }` | parse fail → save + `failed`, URL still `done`. |

HTML link sources: `a[href]`, `img[src]`, `video[src]`, `source[src]`, `link[href]`, `object[data]`, `embed[src]`. Only `http`/`https` schemes are followed.

---

## 10. URL normalization & scope

Normalizer (deterministic dedup key):
1. Resolve relative against the page URL (WHATWG `URL`); the resolved absolute URL is stored as `url` (the fetch target).
2. Lowercase scheme + host; drop default ports (`:80`/`:443`).
3. Drop fragment.
4. Trailing-slash policy: collapse empty path to `/`; strip trailing slash on non-root paths (`/en/` → `/en`).
5. Scheme policy: canonicalize to `https` in the dedup key so `http`/`https` of the same resource collapse to one task. Only the key is affected; the original scheme is still fetched.
6. Keep query string; sort query params for stable dedup (preserving duplicates).

| Input | Normalized (dedup key) |
|---|---|
| `HTTP://WWW.EXAMPLE.COM:80/a#top` | `https://www.example.com/a` |
| `/about` on `https://example.com/products` | `https://example.com/about` |
| `https://example.com` | `https://example.com/` |
| `https://example.com/en/` | `https://example.com/en` |
| `https://example.com/p?b=2&a=1` | `https://example.com/p?a=1&b=2` |

ScopePolicy (default `registrable_domain`): allowed iff the candidate's registrable domain (via `tldts`) equals the run's. Unsupported schemes (`mailto`, `tel`, `javascript`, `data`, `ftp`, `file`) are rejected. Out-of-scope links are recorded as `url_edges` with `in_scope=false` and never enqueued.

---

## 11. Output storage

```
output/<kind>/<hash[0:2]>/<hash[2:4]>/<url_hash>.<ext>
# e.g. output/html/ab/cd/abcd….html   output/images/12/34/1234….png
```
Hash-based names are filesystem-safe, collision-free, stable per normalized URL, and query-string-proof. The extension is derived from `Content-Type`, not the URL. Traceability is preserved via the DB (`crawl_urls.url` ↔ `contents.file_path`).

---

## 12. Resumability & termination

**Resume:** the DB is the source of truth. On start, stale `in_progress` rows (older than a threshold, e.g. 10 min) are reset to `queued` **without** consuming a retry attempt (the previous worker may have died before fetching). `done` URLs are never reprocessed.

**Termination (D6):** a worker exits only when all hold: `claimNextUrl` returns null, no `retryable_failed` has a future `next_attempt_at`, and no rows are `in_progress`. Otherwise it sleeps briefly and re-polls. The run is finalized `completed` / `completed_with_failures` / `limit_reached`.

---

## 13. Safety limits

`max_urls`, `max_depth`, `max_bytes`, `max_runtime_seconds`. On breach: stop claiming, let in-flight work finish, mark the run `limit_reached`, and leave queued URLs in the DB (still resumable).

---

## 14. Observability

Structured `pino` logs with stable event names: `run_started`, `url_claimed`, `fetch_succeeded`, `fetch_failed`, `rate_limited`, `retry_scheduled`, `content_saved`, `links_discovered`, `url_permanent_failed`, `run_completed`. Plus a `status` command:
```bash
npm run status -- --run-id=<uuid>
# prints per-status URL counts, per-kind content counts, bytes downloaded
```
No dashboard (production extension).

---

## 15. Testing

**Unit:** URL normalizer (fragment, ports, trailing slash, scheme, query sort, relative resolve); scope policy (same registrable domain, subdomain per policy, rejected schemes); retry policy (404/403 no-retry, 429 Retry-After, 500 backoff, max attempts, jitter bounds); content-type classifier; file-path strategy; HTML link extraction + count.

**Integration (MockFetchClient):**
1. Simple crawl (HTML → HTML + image), no duplicates.
2. Same URL discovered from two pages → one `crawl_urls` row, one content, two edges.
3. 404 → `permanent_failed`, no retry.
4. 500,500,200 → `attempt_count=3`, `done`.
5. 429 + Retry-After → retryable, `next_attempt_at ≈ now+delay`, limiter paused.
6. Resume: stale `in_progress` reset, `done` untouched, `queued` processed.
7. Concurrency: many workers + same URL from many pages → unique constraint holds, one content row.

---

## 16. Tech stack & dependencies

| Purpose | Package | Why |
|---|---|---|
| CLI | `commander` | tiny, clear. |
| DB | `pg` + hand-written SQL | SQL clarity; no ORM over the frontier queries. |
| Migrations | `node-pg-migrate` | simple. |
| Logging | `pino` | structured, fast. |
| HTML | `cheerio` | lightweight, reliable. |
| Image meta | `image-size` | light, no native build. |
| PDF meta | `pdf-parse` | pages + title. |
| Video meta | `ffprobe` (optional) | best-effort duration; null if absent. |
| Scope | `tldts` | registrable-domain computation (PSL). |
| Tests | `vitest` | fast. |
| Hash | node `crypto` | built in. |

Minimal-dependency rule: every non-trivial dependency is justified; nothing heavy unless a requirement demands it.

---

## 17. Repository structure

```
src/
  cli/            crawl.ts, status.ts, index.ts
  run/            CrawlRunService.ts, RunRepository.ts
  frontier/       FrontierRepository.ts
  fetch/          FetchClient (types), HttpFetchClient.ts, MockFetchClient.ts
  worker/         WorkerPool.ts, worker.ts, RetryPolicy.ts, RateLimiter.ts,
                  ResponseClassifier.ts, ContentProcessor.ts, SafetyLimits.ts
  content/        HandlerRegistry.ts, ContentHandler.ts, HtmlHandler.ts,
                  ImageHandler.ts, VideoHandler.ts, PdfHandler.ts,
                  HandlerContentProcessor.ts, ContentRepository.ts, EdgeRepository.ts
  url/            UrlNormalizer.ts, ScopePolicy.ts, urlHash.ts
  storage/        OutputStorage.ts, FilePathStrategy.ts
  status/         StatusService.ts, formatStatus.ts
  db/             pool.ts
  log/            logger.ts
migrations/       node-pg-migrate SQL migrations
tests/            unit/, integration/
output/           html/ images/ videos/ pdfs/
docker-compose.yml  package.json  README.md  .env.example
```
Modular, not over-abstracted. Interfaces are introduced only where there is a real second implementation or registry need (e.g. `FetchClient`, `ContentHandler`, the worker seams).

---

## 18. Anti-patterns explicitly avoided

- Over-engineering (Kafka/Redis/k8s/browser rendering) without justification.
- In-memory `Set`/array frontier (breaks resume + concurrency).
- Trusting the URL extension over `Content-Type`.
- Spawning a new "crawler" per link instead of enqueuing tasks.
- Silent homepage fallback when the seed 404s (changes user intent).
- Treating metadata failure as fetch failure.
- Exiting workers while HTML parsing is still in flight (termination race).
