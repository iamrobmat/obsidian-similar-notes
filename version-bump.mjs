import { readFileSync, writeFileSync } from 'fs';

// Read manifest and versions
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));

// Update versions.json
versions[manifest.version] = manifest.minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, 2)); 