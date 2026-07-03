# 🕷️ Web Crawler — Take-Home Assignment

> **Level:** Senior Engineer

## Overview

Build a **production-grade site crawler**.

Starting from a seed URL, your crawler should systematically discover and
download an entire website's content — HTML, images, videos, and PDFs —
processing and persisting it along the way.

This assignment is intentionally open-ended. We want to see how *you*
approach an ambiguous, real-world problem: the architecture you choose,
the trade-offs you weigh, and the engineering judgment you apply. There is
no single correct solution.

You may use any tools, including AI coding assistants. **You are fully
accountable for every line you submit** and should be prepared to defend
every design decision in depth.

---

## The Fetch API

Your crawler retrieves all web content through a single external HTTP
service. **You do not implement this service** — treat it as a given,
black-box dependency that already exists. Write your crawler as if this
endpoint is live.

### Endpoint

```
GET http://mock-api.mock.com/fetch?url=<encoded_url>
```

You pass it any URL you want to fetch; it returns that URL's content.

### Response

```typescript
interface FetchResponse {
  statusCode: number;
  headers:    Record<string, string>;   // Content-Type, Content-Length,
                                         // Location, Retry-After, ETag, ...
  body:       Buffer | null;
}

async function fetchUrl(url: string): Promise<FetchResponse>;
```

for example:

```jsonc
{
  "statusCode": 200,
  "headers": {
    "Content-Type":   "text/html",   // what you actually received
    "Content-Length": "10342",
  },
  "body": "<content>"
}
```

Treat the API as a genuine black box: it is unreliable, it rate-limits, and
the same URL may return different results on different attempts. The response
`headers` carry signals you should use deliberately — content type, length,
caching hints, redirect targets, and rate-limit information among them.
Don't trust URL extensions as your source of truth.

### Status Codes

We've kept the set deliberately small. Each maps to a fundamentally
different situation. How you design your response to each — and how cleanly
you separate permanent from transient failures — is part of what we evaluate:

| statusCode | Meaning                    |
|------------|----------------------------|
| `200`      | **Success**                |
| `404`      | **Not Found**              |
| `429`      | **Rate Limited**           |
| `403`      | **Blocked**                |
| `500`      | **Temporary Server Error** |

We won't tell you how to handle each — that's your call to make and justify.

---

## Requirements

### Core Behavior

- Accept a **seed URL** and crawl the site it belongs to
- Discover links and follow them, staying within the seed's domain
- Guarantee each URL is processed at most once, even under concurrency
- Download, process, and persist four content types:
  HTML, images, videos, and PDFs

### Output

Persist downloaded content into separate directories by type:

```
output/
├── html/
├── images/
├── videos/
└── pdfs/
```

Your filenaming and organization strategy is your decision — handle
collisions, query-string URLs, and traceability thoughtfully.

### Per-Type Processing

For each content type, perform a lightweight processing step and persist
the extracted metadata:

| Type       | Task                                                          |
|------------|---------------------------------------------------------------|
| **HTML**   | Extract the page `<title>` and the count of discovered links.  |
| **Images** | Extract dimensions (width × height) and file size.            |
| **Videos** | Extract file size and, if available, duration.                |
| **PDFs**   | Extract page count and document title, if present.            |

We're interested in how you structure this — adding a fifth content type
later should not require rewriting existing handlers.

---

## Persistence & State

Your crawler must use a **database** to persist the information you consider
worth keeping.

We deliberately do not specify a schema or an engine — your data model is a
core part of what we evaluate. Consider what a serious crawler needs to
remember: crawl frontier and visited state, per-URL status and failure
reasons, retry bookkeeping, content metadata, discovery relationships,
content hashes for dedup/change detection, and anything else that makes the
system robust, resumable, and inspectable.

Choose an engine that fits your access patterns and justify it.

---

## External Services & Infrastructure

You are free to incorporate any external infrastructure you believe improves
the design — a message queue, cache, job broker, or otherwise (Redis,
RabbitMQ, Kafka, SQS, etc.).

Use them only where they earn their place. We value judgment over stack size:
a simple design used well beats a complex one added for its own sake, and a
*deliberate decision not to add infrastructure* — well argued — is just as
strong as adding it. Explain every such choice in your README.

A `docker-compose.yml` to bring up your full stack is welcome.

---

## Operational Concerns

We expect a crawler that behaves well in the real world:

- **Resilience** — transient failures are handled without crashing; the
  system self-heals where it can
- **Rate control** — a proper rate-limiting strategy that adapts when the
  API pushes back
- **Concurrency** — parallelism with correct, race-free shared state
- **Resumability** — the crawler can stop and resume without losing or
  duplicating work
- **Observability** — meaningful logging, progress, and inspectable state

How you achieve these is up to you.

---

## Deliverables

## Deliverables

1. **A public Git repository** containing your solution.
   Work as you naturally would — incremental commits are welcome, and AI coding assistants are expected and encouraged.

2. **A short README** (½–1 page) covering:
   - Key architectural decisions and the reasoning behind them
   - Trade-offs you considered and why you chose your approach
   - How this would change at production scale (data volume, reliability, cost)
   - What you'd improve or do differently with more time

3. **(Optional) Your AI collaboration log** — if your tool exports it cleanly, share the prompts/conversation with your coding agent. We're interested in how you direct and verify AI, not just the final output.

> In the follow-up session, we'll walk through your decisions together — be ready to defend your trade-offs and discuss how you'd evolve the design.

---

## What We're Evaluating

We read every line and assess the whole system:

- **Architecture** — separation of concerns, abstractions, extensibility, SOLID
- **Correctness** — does it actually do the job, including the hard edges?
- **Resilience & concurrency** — behavior under failure and at scale
- **Data modeling** — does your schema reflect a deep understanding of the problem?
- **Judgment** — every dependency, service, and trade-off should be defensible
- **Code quality** — readability, cohesion, and the right *amount* of code

> More code is not better. The strongest submissions are often the leanest
> ones that still handle the hard cases gracefully.

---

## Submission

Submit a link to a **Git repository** containing your complete solution.
Commit history is part of the submission and we will review it.

> Build something you'd be proud to put in front of a senior code review —
> because that's exactly what this is.
