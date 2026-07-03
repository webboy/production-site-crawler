import { access } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { ContentRepository } from '../../src/content/ContentRepository.js';
import { HandlerContentProcessor } from '../../src/content/HandlerContentProcessor.js';
import { HandlerRegistry } from '../../src/content/HandlerRegistry.js';
import { HtmlHandler } from '../../src/content/HtmlHandler.js';
import { ImageHandler } from '../../src/content/ImageHandler.js';
import { PdfHandler } from '../../src/content/PdfHandler.js';
import { VideoHandler } from '../../src/content/VideoHandler.js';
import { query } from '../../src/db/pool.js';
import { OutputStorage } from '../../src/storage/OutputStorage.js';
import { urlHash } from '../../src/url/urlHash.js';
import { CORRUPT_PDF, MINIMAL_PDF, TINY_PNG } from '../fixtures/contentFixtures.js';
import {
  canReachDatabase,
  cleanupCrawlRun,
  closeDatabasePool,
  getUrlIdByNormalizedUrl,
  readCrawlUrl,
  runCrawlWithMocks,
} from './crawlTestUtils.js';

const databaseReachable = await canReachDatabase();

function createContentProcessor(outputDir: string): HandlerContentProcessor {
  return new HandlerContentProcessor(
    new HandlerRegistry([
      new HtmlHandler(),
      new ImageHandler(),
      new VideoHandler(),
      new PdfHandler(),
    ]),
    new OutputStorage(outputDir),
    new ContentRepository(),
  );
}

describe.skipIf(!databaseReachable)('content processing integration', () => {
  let outputDir: string;

  afterAll(async () => {
    await closeDatabasePool();
  });

  afterEach(async () => {
    if (outputDir !== undefined) {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('persists files, contents, edges, and enqueues discovered in-scope URLs (§15 scenario 1: HTML to HTML + image)', async () => {
    outputDir = await mkdtemp(path.join(os.tmpdir(), 'crawler-output-'));

    const seedUrl = 'https://example.com/content-seed';
    const childHtmlUrl = 'https://example.com/content-child';
    const childHtmlNormalized = 'https://example.com/content-child';
    const imageUrl = 'https://example.com/content-image.png';
    const imageNormalized = 'https://example.com/content-image.png';
    const pdfUrl = 'https://example.com/content-doc.pdf';
    const pdfNormalized = 'https://example.com/content-doc.pdf';
    const externalUrl = 'https://other.example.org/external';

    const seedHtml = Buffer.from(`
      <html>
        <head><title>Seed</title></head>
        <body>
          <a href="${childHtmlUrl}">Child</a>
          <img src="${imageUrl}" />
          <a href="${pdfUrl}">PDF</a>
          <a href="${externalUrl}">External</a>
        </body>
      </html>
    `);

    const { runId } = await runCrawlWithMocks({
      seedUrl,
      contentProcessor: createContentProcessor(outputDir),
      mockResponses: {
        [seedUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: seedHtml,
        },
        [childHtmlUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html><head><title>Child</title></head><body></body></html>'),
        },
        [imageUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'image/png' },
          body: TINY_PNG,
        },
        [pdfUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'application/pdf' },
          body: MINIMAL_PDF,
        },
      },
      concurrency: 2,
      pollMs: 50,
    });

    try {
      const seedHash = urlHash('https://example.com/content-seed');
      const imageHash = urlHash(imageNormalized);
      const pdfHash = urlHash(pdfNormalized);

      const seedFile = path.join(
        outputDir,
        'html',
        seedHash.slice(0, 2),
        seedHash.slice(2, 4),
        `${seedHash}.html`,
      );
      const imageFile = path.join(
        outputDir,
        'images',
        imageHash.slice(0, 2),
        imageHash.slice(2, 4),
        `${imageHash}.png`,
      );
      const pdfFile = path.join(
        outputDir,
        'pdfs',
        pdfHash.slice(0, 2),
        pdfHash.slice(2, 4),
        `${pdfHash}.pdf`,
      );

      await expect(access(seedFile)).resolves.toBeUndefined();
      await expect(access(imageFile)).resolves.toBeUndefined();
      await expect(access(pdfFile)).resolves.toBeUndefined();

      const contents = await query<{ kind: string; metadata_status: string }>(
        `
          SELECT kind, metadata_status
          FROM contents
          WHERE crawl_run_id = $1
          ORDER BY kind
        `,
        [runId],
      );

      expect(contents.rows.map((row) => row.kind).sort()).toEqual(['html', 'html', 'image', 'pdf']);

      const edges = await query<{
        in_scope: boolean;
        to_url_id: string | null;
        normalized_discovered_url: string | null;
      }>(
        `
          SELECT in_scope, to_url_id, normalized_discovered_url
          FROM url_edges
          WHERE crawl_run_id = $1
        `,
        [runId],
      );

      expect(edges.rows.length).toBeGreaterThanOrEqual(4);
      expect(edges.rows.some((row) => row.normalized_discovered_url === childHtmlNormalized)).toBe(
        true,
      );
      expect(edges.rows.some((row) => row.normalized_discovered_url === imageNormalized)).toBe(
        true,
      );
      expect(
        edges.rows.some((row) => row.normalized_discovered_url?.includes('other.example.org')),
      ).toBe(true);
      const externalEdge = edges.rows.find((row) =>
        row.normalized_discovered_url?.includes('other.example.org'),
      );
      expect(externalEdge).toMatchObject({ in_scope: false, to_url_id: null });

      const childHtmlUrlId = await getUrlIdByNormalizedUrl(runId, childHtmlNormalized);
      const imageUrlId = await getUrlIdByNormalizedUrl(runId, imageNormalized);
      expect(childHtmlUrlId).toBeTruthy();
      expect(imageUrlId).toBeTruthy();
      await expect(readCrawlUrl(childHtmlUrlId as string)).resolves.toMatchObject({
        status: 'done',
      });
      await expect(readCrawlUrl(imageUrlId as string)).resolves.toMatchObject({ status: 'done' });
      expect(await getUrlIdByNormalizedUrl(runId, pdfNormalized)).toBeTruthy();
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('records two edges but one contents row when the same target is discovered twice (§15 scenario 2)', async () => {
    outputDir = await mkdtemp(path.join(os.tmpdir(), 'crawler-output-'));

    const seedUrl = 'https://example.com/dedup-seed';
    const pageOneUrl = 'https://example.com/dedup-page-one';
    const pageTwoUrl = 'https://example.com/dedup-page-two';
    const targetUrl = 'https://example.com/dedup-target';
    const targetNormalized = 'https://example.com/dedup-target';

    const { runId } = await runCrawlWithMocks({
      seedUrl,
      contentProcessor: createContentProcessor(outputDir),
      mockResponses: {
        [seedUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from(`
            <html><body>
              <a href="${pageOneUrl}">One</a>
              <a href="${pageTwoUrl}">Two</a>
            </body></html>
          `),
        },
        [pageOneUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from(`<html><body><a href="${targetUrl}">Target</a></body></html>`),
        },
        [pageTwoUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from(`<html><body><a href="${targetUrl}">Target again</a></body></html>`),
        },
        [targetUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html><body>target</body></html>'),
        },
      },
      concurrency: 2,
      pollMs: 50,
    });

    try {
      const targetRows = await query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM crawl_urls
          WHERE crawl_run_id = $1
            AND normalized_url = $2
        `,
        [runId, targetNormalized],
      );

      const contentRows = await query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM contents c
          JOIN crawl_urls u ON u.id = c.crawl_url_id
          WHERE u.crawl_run_id = $1
            AND u.normalized_url = $2
        `,
        [runId, targetNormalized],
      );

      const edgeDetails = await query<{ to_url_id: string | null }>(
        `
          SELECT to_url_id
          FROM url_edges
          WHERE crawl_run_id = $1
            AND normalized_discovered_url = $2
        `,
        [runId, targetNormalized],
      );

      expect(Number(targetRows.rows[0]?.count)).toBe(1);
      expect(Number(contentRows.rows[0]?.count)).toBe(1);
      expect(edgeDetails.rows).toHaveLength(2);
      expect(
        edgeDetails.rows.every((row) => row.to_url_id === edgeDetails.rows[0]?.to_url_id),
      ).toBe(true);
      expect(edgeDetails.rows[0]?.to_url_id).toBeTruthy();
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('marks corrupt PDF metadata as failed while keeping the crawl URL done', async () => {
    outputDir = await mkdtemp(path.join(os.tmpdir(), 'crawler-output-'));

    const seedUrl = 'https://example.com/corrupt-pdf-seed';
    const pdfUrl = 'https://example.com/corrupt.pdf';

    const { runId } = await runCrawlWithMocks({
      seedUrl,
      contentProcessor: createContentProcessor(outputDir),
      mockResponses: {
        [seedUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from(`<html><body><a href="${pdfUrl}">PDF</a></body></html>`),
        },
        [pdfUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'application/pdf' },
          body: CORRUPT_PDF,
        },
      },
      pollMs: 50,
    });

    try {
      const pdfUrlId = await getUrlIdByNormalizedUrl(runId, 'https://example.com/corrupt.pdf');
      expect(pdfUrlId).toBeTruthy();

      const crawlUrl = await readCrawlUrl(pdfUrlId as string);
      expect(crawlUrl?.status).toBe('done');

      const content = await query<{ metadata_status: string }>(
        `
          SELECT metadata_status
          FROM contents
          WHERE crawl_url_id = $1
        `,
        [pdfUrlId],
      );

      expect(content.rows[0]?.metadata_status).toBe('failed');
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('skips unsupported content without saving files or contents rows', async () => {
    outputDir = await mkdtemp(path.join(os.tmpdir(), 'crawler-output-'));

    const seedUrl = 'https://example.com/unsupported-seed';
    const jsonUrl = 'https://example.com/data.json';

    const { runId } = await runCrawlWithMocks({
      seedUrl,
      contentProcessor: createContentProcessor(outputDir),
      mockResponses: {
        [seedUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from(`<html><body><a href="${jsonUrl}">JSON</a></body></html>`),
        },
        [jsonUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from('{"hello":"world"}'),
        },
      },
      pollMs: 50,
    });

    try {
      const jsonUrlId = await getUrlIdByNormalizedUrl(runId, 'https://example.com/data.json');
      expect(jsonUrlId).toBeTruthy();

      const crawlUrl = await readCrawlUrl(jsonUrlId as string);
      expect(crawlUrl?.status).toBe('skipped_unsupported');

      const contentCount = await query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM contents
          WHERE crawl_run_id = $1
        `,
        [runId],
      );

      expect(Number(contentCount.rows[0]?.count)).toBe(1);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });
});
