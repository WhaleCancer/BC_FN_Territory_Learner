import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'public', 'data');

const DATASETS = [
  {
    id: 'bc_statement_of_intent',
    mode: 'territory',
    displayName: 'BC Statement of Intent Boundaries',
    description:
      'Statement of Intent boundaries submitted through BC treaty processes. Useful for broad learning coverage, but not intended to represent settled treaty lands.',
    outputFile: 'bc-statement-of-intent.geojson',
    serviceUrl:
      'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_reg_legal_and_admin_boundaries/MapServer/1',
    primaryNameField: 'NAME',
    fallbackNameFields: [],
    sourceLabel: 'First Nation Statement of Intent Boundaries BC',
    sourceMetadata:
      'https://catalogue.data.gov.bc.ca/dataset/69ea1b64-e7ce-481c-b0b5-e6450111697d',
  },
  {
    id: 'bc_treaty_areas',
    mode: 'territory',
    displayName: 'BC First Nations Treaty Areas',
    description:
      'Treaty-area boundaries from modern treaty processes across BC, grouped by First Nation name.',
    outputFile: 'bc-treaty-areas.geojson',
    serviceUrl:
      'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_legal_admin_boundaries/MapServer/17',
    primaryNameField: 'FIRST_NATION_NAME',
    fallbackNameFields: ['TREATY'],
    sourceLabel: 'First Nations Treaty Areas',
    sourceMetadata:
      'https://catalogue.data.gov.bc.ca/dataset/c1a5d55e-fef9-4605-8b20-c08ed4f0c870',
  },
  {
    id: 'bc_treaty_lands',
    mode: 'territory',
    displayName: 'BC First Nations Treaty Lands',
    description:
      'Treaty land polygons representing lands associated with modern treaties in BC.',
    outputFile: 'bc-treaty-lands.geojson',
    serviceUrl:
      'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_legal_admin_boundaries/MapServer/19',
    primaryNameField: 'FIRST_NATION_NAME',
    fallbackNameFields: ['TREATY'],
    sourceLabel: 'First Nations Treaty Lands',
    sourceMetadata:
      'https://catalogue.data.gov.bc.ca/dataset/fd34808d-4be6-45ea-bc23-65109147933a',
  },
  {
    id: 'bc_treaty_related_lands',
    mode: 'territory',
    displayName: 'BC First Nations Treaty Related Lands',
    description:
      'Treaty-related land boundaries connected to ratified treaty arrangements in BC.',
    outputFile: 'bc-treaty-related-lands.geojson',
    serviceUrl:
      'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_legal_admin_boundaries/MapServer/0',
    primaryNameField: 'FIRST_NATION_NAME',
    fallbackNameFields: ['TREATY'],
    sourceLabel: 'First Nations Treaty Related Lands',
    sourceMetadata:
      'https://catalogue.data.gov.bc.ca/dataset/7b4e5fce-161b-44dd-8ab4-e185d9539a46',
  },
];

const MAX_BATCH_SIZE = 120;
const ROUNDING_FACTOR = 1e5;

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function makeUniqueId(name, usedIds) {
  const base = slugify(name) || 'unnamed';

  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }

  let suffix = 2;
  while (usedIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  const uniqueId = `${base}-${suffix}`;
  usedIds.add(uniqueId);
  return uniqueId;
}

function chunkArray(values, chunkSize) {
  const chunks = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function roundNumber(value) {
  return Math.round(value * ROUNDING_FACTOR) / ROUNDING_FACTOR;
}

function roundCoordinates(value) {
  if (typeof value === 'number') {
    return roundNumber(value);
  }

  if (Array.isArray(value)) {
    return value.map(roundCoordinates);
  }

  return value;
}

function asMultiPolygonCoordinates(geometry) {
  if (!geometry) {
    return [];
  }

  if (geometry.type === 'Polygon') {
    return [roundCoordinates(geometry.coordinates)];
  }

  if (geometry.type === 'MultiPolygon') {
    return roundCoordinates(geometry.coordinates);
  }

  return [];
}

function trimName(properties, fields) {
  for (const field of fields) {
    const candidate = properties[field];
    if (typeof candidate === 'string') {
      const normalized = candidate.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return '';
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} at ${url}`);
  }
  return response.json();
}

async function fetchObjectIds(serviceUrl) {
  const params = new URLSearchParams({
    where: '1=1',
    returnIdsOnly: 'true',
    f: 'pjson',
  });
  const json = await fetchJson(`${serviceUrl}/query?${params.toString()}`);
  const objectIds = Array.isArray(json.objectIds) ? json.objectIds : [];
  return objectIds.sort((left, right) => left - right);
}

async function fetchFeatureBatch(serviceUrl, objectIds) {
  const params = new URLSearchParams({
    objectIds: objectIds.join(','),
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });

  return fetchJson(`${serviceUrl}/query?${params.toString()}`);
}

function normalizeCollection(rawCollection, datasetConfig) {
  const groupedByName = new Map();
  const nameFields = [datasetConfig.primaryNameField, ...datasetConfig.fallbackNameFields];

  for (const feature of rawCollection.features) {
    const geometryParts = asMultiPolygonCoordinates(feature.geometry);
    if (!geometryParts.length) {
      continue;
    }

    const name = trimName(feature.properties ?? {}, nameFields);
    if (!name) {
      continue;
    }

    if (!groupedByName.has(name)) {
      groupedByName.set(name, {
        geometryParts: [],
        sourceCount: 0,
      });
    }

    const group = groupedByName.get(name);
    group.geometryParts.push(...geometryParts);
    group.sourceCount += 1;
  }

  const usedIds = new Set();
  const normalizedFeatures = [...groupedByName.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([name, value]) => ({
      type: 'Feature',
      properties: {
        id: makeUniqueId(name, usedIds),
        name,
        mode: datasetConfig.mode,
        sourceCount: value.sourceCount,
        polygonCount: value.geometryParts.length,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: value.geometryParts,
      },
    }));

  return {
    type: 'FeatureCollection',
    features: normalizedFeatures,
  };
}

async function fetchDataset(datasetConfig) {
  console.log(`\nFetching ${datasetConfig.displayName}...`);
  const objectIds = await fetchObjectIds(datasetConfig.serviceUrl);
  const chunks = chunkArray(objectIds, MAX_BATCH_SIZE);
  const combinedFeatures = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkCollection = await fetchFeatureBatch(datasetConfig.serviceUrl, chunk);
    const chunkFeatures = Array.isArray(chunkCollection.features) ? chunkCollection.features : [];
    combinedFeatures.push(...chunkFeatures);

    console.log(
      `  Batch ${index + 1}/${chunks.length}: ${chunkFeatures.length} features (running total ${combinedFeatures.length})`,
    );
  }

  const normalized = normalizeCollection(
    {
      type: 'FeatureCollection',
      features: combinedFeatures,
    },
    datasetConfig,
  );

  console.log(
    `  Complete: ${combinedFeatures.length} raw polygons -> ${normalized.features.length} quiz entries`,
  );

  return {
    normalized,
    rawFeatureCount: combinedFeatures.length,
    groupedFeatureCount: normalized.features.length,
  };
}

async function writeJson(fileName, value) {
  const filePath = path.join(outputDir, fileName);
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const sourceSummary = [];

  for (const dataset of DATASETS) {
    const result = await fetchDataset(dataset);
    await writeJson(dataset.outputFile, result.normalized);

    sourceSummary.push({
      id: dataset.id,
      mode: dataset.mode,
      displayName: dataset.displayName,
      description: dataset.description,
      sourceLabel: dataset.sourceLabel,
      serviceUrl: dataset.serviceUrl,
      metadataUrl: dataset.sourceMetadata,
      outputFile: dataset.outputFile,
      fetchedAtUtc: new Date().toISOString(),
      rawFeatureCount: result.rawFeatureCount,
      groupedFeatureCount: result.groupedFeatureCount,
    });
  }

  await writeJson('sources.json', {
    note: 'Public BC government datasets transformed for NationsLearner gameplay.',
    license:
      'Data provided by the Province of British Columbia under the Open Government Licence - British Columbia.',
    defaultDatasetId: DATASETS[0].id,
    datasets: sourceSummary,
  });

  console.log('\nData files written to public/data');
}

main().catch((error) => {
  console.error('\nData fetch failed.');
  console.error(error);
  process.exit(1);
});
