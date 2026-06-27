/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
import puppeteerExtractor from '../services/extractor/puppeteerExtractor.js';
import logger from '../services/logger.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

// Wunderflats server-renders the full search results into a `data-hydrant` JSON
// blob inside the page HTML (no separate listing API needed). We fetch the page
// with the shared stealth browser and read the listings straight out of that
// blob — far more reliable than scraping rendered DOM nodes.
const BASE_URL = 'https://wunderflats.com/';

let appliedBlackList = [];

/**
 * Extract and parse the `data-hydrant` JSON blob embedded in a Wunderflats page.
 *
 * @param {string|null} html
 * @returns {any|null} Parsed hydrant object, or null when absent/unparseable.
 */
function parseHydrant(html) {
  if (!html) return null;
  const match = html.match(/<script id="data-hydrant" type="application\/json">(.*?)<\/script>/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Turn a listing title into a URL slug. The slug is cosmetic — Wunderflats
 * resolves `/en/furnished-apartment/<slug>/<id>` by id and redirects to the
 * canonical slug — so a best-effort transliteration is sufficient.
 *
 * @param {string} title
 * @returns {string}
 */
function slugify(title) {
  return (
    String(title || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u00df/g, 'ss')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80) || 'apartment'
  );
}

/**
 * Build a single raw listing row from a Wunderflats hydrant item.
 *
 * @param {any} item
 * @returns {any}
 */
function toRawListing(item) {
  const title = item.title?.en || item.title?.de || '';
  const coords = item.address?.location?.coordinates; // [lng, lat]
  const image =
    item.coverImage?.urls?.original || item.images?.[0]?.urls?.original || item.pictures?.[0] || null;
  return {
    id: item._id,
    title,
    // Wunderflats stores the monthly price in cents.
    price: item.price != null ? item.price / 100 : null,
    size: item.area,
    rooms: item.rooms,
    link: `${BASE_URL}en/furnished-apartment/${slugify(title)}/${item._id}`,
    address: [item.address?.street, item.address?.city].filter(Boolean).join(', '),
    image,
    description: null,
    latitude: Array.isArray(coords) ? coords[1] : undefined,
    longitude: Array.isArray(coords) ? coords[0] : undefined,
  };
}

/**
 * Fetch the configured Wunderflats search page and read the listings out of its
 * embedded hydrant blob. Returns raw rows for {@link normalize}.
 *
 * @this {{ _browser?: any }}
 * @param {string} url
 * @returns {Promise<any[]>}
 */
async function getListings(url) {
  const html = await puppeteerExtractor(url, null, {
    browser: this?._browser,
    name: 'wunderflats',
    ...config.puppeteerOptions,
  });
  const hydrant = parseHydrant(html);
  const items = hydrant?.pageData?.listingResults?.items;
  if (!Array.isArray(items)) {
    if (html) logger.warn('Wunderflats: could not find listingResults in page hydrant for url', url);
    return [];
  }
  return items.map(toRawListing);
}

/**
 * Enrich a listing with the full description (and a more precise address) from
 * its detail page hydrant. Always resolves; falls back to the original listing
 * when the detail page is unavailable.
 *
 * @param {ParsedListing} listing
 * @param {any} browser
 * @returns {Promise<ParsedListing>}
 */
async function fetchDetails(listing, browser) {
  try {
    const html = await puppeteerExtractor(listing.link, null, { browser, name: 'wunderflats_details' });
    const hydrant = parseHydrant(html);
    const detail = hydrant?.pageData?.listing;
    if (!detail) return listing;

    const description = detail.descriptionV2?.en || detail.descriptionV2?.de || listing.description;
    let address = listing.address;
    if (detail.address) {
      const full = [detail.address.street, detail.address.postalCode, detail.address.city]
        .filter(Boolean)
        .join(', ');
      if (full) address = full;
    }
    return { ...listing, address, description: description || listing.description };
  } catch (error) {
    logger.warn(`Could not fetch wunderflats detail page for listing '${listing.id}'.`, error?.message || error);
    return listing;
  }
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const id = buildHash(String(o.id ?? ''), String(o.price ?? ''));
  return {
    id,
    link: o.link,
    title: o.title || '',
    price: extractNumber(o.price),
    size: extractNumber(o.size),
    rooms: extractNumber(o.rooms),
    address: o.address,
    image: o.image,
    description: o.description,
    latitude: o.latitude,
    longitude: o.longitude,
  };
}

/**
 * @param {ParsedListing} o
 * @returns {boolean}
 */
function applyBlacklist(o) {
  const titleNotBlacklisted = !isOneOf(o.title, appliedBlackList);
  const descNotBlacklisted = !isOneOf(o.description, appliedBlackList);
  return titleNotBlacklisted && descNotBlacklisted;
}

/** @type {ProviderConfig} */
const config = {
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image', 'description'],
  url: null,
  // getListings reads the page's embedded hydrant directly, so no URL sort
  // param mutation is applied; the configured search URL controls ordering.
  sortByDateParam: null,
  // No CSS scraping (custom getListings reads the hydrant), but the link
  // selector lets the fixture downloader locate a detail page for the
  // _detail.html fixture.
  crawlFields: {
    link: 'a[href*="/furnished-apartment/"]@href',
  },
  normalize: normalize,
  filter: applyBlacklist,
  getListings: getListings,
  fetchDetails: fetchDetails,
  activeTester: checkIfListingIsActive,
};

export const init = (sourceConfig, blacklist) => {
  config.enabled = sourceConfig.enabled;
  config.url = sourceConfig.url;
  appliedBlackList = blacklist || [];
};

export const metaInformation = {
  name: 'Wunderflats',
  baseUrl: BASE_URL,
  id: 'wunderflats',
};

export { config };
