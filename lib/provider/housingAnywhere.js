/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
import logger from '../services/logger.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

// HousingAnywhere's search results are served from a public Algolia index that
// the website queries client-side. We talk to the same index directly (no
// browser needed), which is far more stable than scraping the React-rendered
// DOM. The application id and search-only API key are the public credentials
// embedded in HousingAnywhere's frontend bundle; `production_listings_most_recent`
// is their "newest first" replica, giving us date-sorted results for free.
const ALGOLIA_APP_ID = 'Y8L112MIBF';
const ALGOLIA_API_KEY = '170cf5d8f85035f219107d6fb900e3dd';
const ALGOLIA_INDEX = 'production_listings_most_recent';
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;
const BASE_URL = 'https://housinganywhere.com/';
const HITS_PER_PAGE = 50;

// Human-readable labels per Algolia `propertyType` facet value, used to build a
// listing title (HousingAnywhere hits have no dedicated title field).
const PROPERTY_TYPE_LABEL = {
  APARTMENT: 'Apartment',
  PRIVATE_ROOM: 'Private room',
  SHARED_ROOM: 'Shared room',
  STUDIO: 'Studio',
  HOUSE: 'House',
  BUILDING: 'Building',
};

let appliedBlackList = [];

/**
 * Parse the city, country and (optional) property category out of a
 * HousingAnywhere search URL such as
 * `https://housinganywhere.com/s/Berlin--Germany/apartment-for-rent`.
 * The `/s/` segment encodes `City--Country` (double-dash separated); single
 * dashes inside the city/country are word separators and become spaces.
 *
 * @param {string} rawUrl
 * @returns {{ city: string|null, country: string|null, category: string|null }}
 */
function parseSearchUrl(rawUrl) {
  try {
    const parts = new URL(rawUrl).pathname.split('/').filter(Boolean);
    const sIdx = parts.indexOf('s');
    if (sIdx === -1 || !parts[sIdx + 1]) return { city: null, country: null, category: null };
    const [citySlug, countrySlug] = parts[sIdx + 1].split('--');
    const deslug = (s) => decodeURIComponent(s || '').replace(/-/g, ' ').trim();
    return {
      city: deslug(citySlug) || null,
      country: deslug(countrySlug) || null,
      category: parts[sIdx + 2] ? decodeURIComponent(parts[sIdx + 2]).toLowerCase() : null,
    };
  } catch {
    return { city: null, country: null, category: null };
  }
}

/**
 * Map a HousingAnywhere URL category slug (e.g. `apartment-for-rent`) to the
 * Algolia `propertyType` facet value. Returns null when the category does not
 * map to a single property type (then no type filter is applied).
 *
 * @param {string|null} category
 * @returns {string|null}
 */
function categoryToPropertyType(category) {
  if (!category) return null;
  if (category.includes('private-room')) return 'PRIVATE_ROOM';
  if (category.includes('shared-room')) return 'SHARED_ROOM';
  if (category.includes('studio')) return 'STUDIO';
  if (category.includes('house')) return 'HOUSE';
  if (category.includes('apartment')) return 'APARTMENT';
  return null;
}

/**
 * Fetch the newest listings for the configured search from HousingAnywhere's
 * Algolia index. Returns raw rows that {@link normalize} converts to the
 * ParsedListing shape.
 *
 * @param {string} url The configured HousingAnywhere search URL.
 * @returns {Promise<any[]>}
 */
async function getListings(url) {
  const { city, country, category } = parseSearchUrl(url);
  if (!city || !country) {
    logger.warn('HousingAnywhere: could not parse city/country from url', url);
    return [];
  }

  const filters = [`city:'${city}'`, `country:'${country}'`, 'isSearchable:true'];
  const propertyType = categoryToPropertyType(category);
  if (propertyType) filters.push(`propertyType:'${propertyType}'`);

  const params = new URLSearchParams({
    hitsPerPage: String(HITS_PER_PAGE),
    filters: filters.join(' AND '),
  }).toString();

  const response = await fetch(ALGOLIA_URL, {
    method: 'POST',
    headers: {
      'X-Algolia-Application-Id': ALGOLIA_APP_ID,
      'X-Algolia-API-Key': ALGOLIA_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ params }),
  });

  if (!response.ok) {
    logger.error('Error fetching data from HousingAnywhere Algolia API:', response.statusText);
    return [];
  }

  const body = await response.json();
  return (body.hits || []).map((hit) => {
    const where = hit.street || hit.neighborhood || hit.city;
    const type = PROPERTY_TYPE_LABEL[hit.propertyType] || 'Property';
    return {
      id: hit.internalID ?? hit.objectID,
      title: where ? `${type} in ${where}` : type,
      price: hit.priceEUR ?? hit.price,
      size: hit.propertySize ?? hit.facility_total_size,
      rooms: hit.apartmentBedroomCount ?? hit.facility_bedroom_count,
      link: hit.path ? `${BASE_URL}${String(hit.path).replace(/^\//, '')}` : BASE_URL,
      address: [hit.street, hit.neighborhood, hit.city, hit.country].filter(Boolean).join(', '),
      image: hit.thumbnailURL ?? (Array.isArray(hit.photos) ? hit.photos[0] : null),
      description: hit.description,
      latitude: hit._geoloc?.lat,
      longitude: hit._geoloc?.lng,
    };
  });
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
  // getListings already returns date-sorted results (via the `most_recent`
  // Algolia replica), so no sort-by-date query param injection is needed.
  sortByDateParam: null,
  // Vestigial for API-based providers (the custom getListings bypasses the
  // Cheerio parser); kept to document the Algolia hit → field mapping.
  crawlFields: {
    id: 'internalID',
    title: 'propertyType + street',
    price: 'priceEUR',
    size: 'propertySize',
    rooms: 'apartmentBedroomCount',
    link: 'path',
    address: 'street, neighborhood, city, country',
    image: 'thumbnailURL',
    description: 'description',
  },
  normalize: normalize,
  filter: applyBlacklist,
  getListings: getListings,
  activeTester: checkIfListingIsActive,
};

export const init = (sourceConfig, blacklist) => {
  config.enabled = sourceConfig.enabled;
  config.url = sourceConfig.url;
  appliedBlackList = blacklist || [];
};

export const metaInformation = {
  name: 'HousingAnywhere',
  baseUrl: BASE_URL,
  id: 'housingAnywhere',
};

export { config };
