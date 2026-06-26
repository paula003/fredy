/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { expect } from 'vitest';
import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { mockFredy, providerConfig } from '../utils.js';
import { get } from '../mocks/mockNotification.js';
import * as provider from '../../lib/provider/housingAnywhere.js';

// HousingAnywhere queries a public Algolia index (fetch-based, no browser). In
// offline mode the fetch mock serves test/testFixtures/housingAnywhere_list.json;
// in live mode it hits Algolia directly.
const TEST_TIMEOUT = 120_000;

describe('#housingAnywhere provider testsuite()', () => {
  provider.init(providerConfig.housingAnywhere, [], []);

  it(
    'should test housingAnywhere provider',
    async () => {
      const Fredy = await mockFredy();
      const mockedJob = {
        id: '',
        notificationAdapter: null,
        spatialFilter: null,
        specFilter: null,
      };

      return await new Promise((resolve, reject) => {
        const fredy = new Fredy(provider.config, mockedJob, provider.metaInformation.id, similarityCache, undefined);
        fredy.execute().then((listings) => {
          if (listings == null || listings.length === 0) {
            reject('Listings is empty!');
            return;
          }

          expect(listings).toBeInstanceOf(Array);
          const notificationObj = get();
          expect(notificationObj).toBeTypeOf('object');
          expect(notificationObj.serviceName).toBe('housingAnywhere');

          // at least one fully-formed, valid notification
          const hasValidNotification = notificationObj.payload.some((notify) => {
            return (
              typeof notify.id === 'string' &&
              typeof notify.price === 'string' &&
              notify.price.includes('€') &&
              typeof notify.size === 'string' &&
              notify.size.includes('m²') &&
              typeof notify.title === 'string' &&
              notify.title !== '' &&
              typeof notify.link === 'string' &&
              notify.link.includes('https://housinganywhere.com/room/') &&
              typeof notify.address === 'string' &&
              notify.address !== ''
            );
          });

          expect(hasValidNotification).toBe(true);
          resolve();
        }, reject);
      });
    },
    TEST_TIMEOUT,
  );
});
