import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

// How long to serve mappings from memory before re-reading the Google Sheet.
// Module-scope state survives across invocations on a warm Lambda container,
// so bursts of traffic hit memory instead of the Sheets API (which has a
// per-minute read quota).
const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300) * 1000;

let cache = null; // { mappings: Map<path, url[]>, fetchedAt: ms }

function httpResponse(status, body, location) {
  var response = {statusCode: status, headers: {}};

  if (location) {
    response.headers['location'] = location;
  }
  if (body) {
    response.body = body;
    response.headers['Content-Type'] = "text/html";
  }

  response.headers['Cache-Control'] = 'private, no-cache, no-store, must-revalidate';
  response.headers['Expires'] = '-1';
  response.headers['Pragma'] = 'no-cache';

  return response;
}

async function fetchMappings() {
  const auth = new JWT({
    email: process.env.SERVICE_ACCOUNT_EMAIL,
    key: process.env.SERVICE_ACCOUNT_PK.replace(/\\n/g, "\n"),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const spreadsheet = new GoogleSpreadsheet(process.env.SHEET_ID, auth); // Sheet ID (visible in URL)

  await spreadsheet.loadInfo();
  const sheet = spreadsheet.sheetsByIndex[0];
  const rows = await sheet.getRows({limit: 100000, offset: 0});

  const mappings = new Map();
  for (const row of rows) {
    const path = row.get('Vanity Path');
    if (!path) continue;
    if (!mappings.has(path)) mappings.set(path, []);
    mappings.get(path).push(row.get('Destination URL'));
  }
  return mappings;
}

async function getMappings() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.mappings;
  }
  try {
    const mappings = await fetchMappings();
    cache = {mappings, fetchedAt: Date.now()};
    return mappings;
  } catch (err) {
    // If Google is rate limiting or down, keep serving the last good copy.
    if (cache) {
      console.warn('Sheet fetch failed, serving stale cache:', err.message);
      return cache.mappings;
    }
    throw err;
  }
}

export const handler = async (event) => {
  const mappings = await getMappings();

  const target = event.path.substring(1); // remove leading slash
  const matches = mappings.get(target) || [];

  if (matches.length == 0) {
    if (process.env.NO_MATCH_REDIR_URL) {
      return httpResponse(302, null, process.env.NO_MATCH_REDIR_URL.replace(/SHORTURL/g, target));
    }
    return httpResponse(404, "No match for " + target, null);
  }
  if (matches.length > 1) {
    return httpResponse(404, "Multiple matches", null);
  }

  return httpResponse(302, null, matches[0]);
};
