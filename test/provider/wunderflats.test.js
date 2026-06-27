/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { mockFredy, providerConfig } from '../utils.js';
import { expect } from 'vitest';
import * as provider from '../../lib/provider/wunderflats.js';
import { launchBrowser, closeBrowser } from '../../lib/services/extractor/puppeteerExtractor.js';

// Wunderflats reads listings from the page's embedded `data-hydrant` JSON, which
// is present in the server-rendered HTML. One browser is shared across the suite
// (search page + detail page) to keep the session warm. In offline mode the
// extractor is mocked to serve test/testFixtures/wunderflats(.|_detail.)html.
const TEST_TIMEOUT = 180_000;

describe('#wunderflats testsuite()', () => {
  let browser;
  let liveListings;

  beforeAll(async () => {
    browser = await launchBrowser(providerConfig.wunderflats.url);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  });

  it(
    'should test wunderflats provider',
    async () => {
      const Fredy = await mockFredy();
      const mockedJob = {
        id: 'wunderflats',
        notificationAdapter: null,
        spatialFilter: null,
        specFilter: null,
      };
      provider.init(providerConfig.wunderflats, [], []);

      const fredy = new Fredy(provider.config, mockedJob, provider.metaInformation.id, similarityCache, browser);

      liveListings = await fredy.execute();

      if (liveListings == null || liveListings.length === 0) {
        throw new Error('Listings is empty!');
      }

      expect(liveListings).toBeInstanceOf(Array);
      const notificationObj = get();
      expect(notificationObj).toBeTypeOf('object');
      expect(notificationObj.serviceName).toBe('wunderflats');
      notificationObj.payload.forEach((notify) => {
        expect(notify.id).toBeTypeOf('string');
        if (notify.price != null) {
          expect(notify.price).toBeTypeOf('string');
          expect(notify.price).toContain('€');
        }
        expect(notify.title).toBeTypeOf('string');
        expect(notify.title).not.toBe('');
        expect(notify.link).toBeTypeOf('string');
        expect(notify.link).toContain('https://wunderflats.com/en/furnished-apartment/');
        expect(notify.address).toBeTypeOf('string');
        expect(notify.address).not.toBe('');
        if (notify.size != null && notify.size.trim().toLowerCase() !== 'k.a.') {
          expect(notify.size).toContain('m²');
        }
      });
    },
    TEST_TIMEOUT,
  );

  describe('with provider_details enabled', () => {
    it(
      'should enrich listings with a description from the detail page',
      async () => {
        if (!liveListings?.length) throw new Error('No listings from first test to enrich');

        const enriched = await provider.config.fetchDetails(liveListings[0], browser);

        expect(enriched).toBeTruthy();
        expect(enriched.link).toContain('https://wunderflats.com/en/furnished-apartment/');
        expect(enriched.address).toBeTypeOf('string');
        expect(enriched.address).not.toBe('');
        if (enriched.description != null) {
          expect(enriched.description).toBeTypeOf('string');
        }
        // Availability date comes from the detail hydrant (best-effort). When
        // present it must be ISO; the offline fixture exposes 2025-01-27.
        if (enriched.availableFrom != null) {
          expect(enriched.availableFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        if (process.env.TEST_MODE === 'offline') {
          expect(enriched.availableFrom).toBe('2025-01-27');
        }
      },
      TEST_TIMEOUT,
    );
  });
});
