import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [, , rawVersion] = process.argv;

if (!rawVersion) {
  console.error('Usage: npm run set-version -- <version>');
  process.exit(1);
}

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

if (!semverPattern.test(rawVersion)) {
  console.error(`Invalid version "${rawVersion}". Use semantic versioning (e.g. 1.2.3 or 1.2.3-beta.1).`);
  process.exit(1);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function updateJsonFile(filePath, transform) {
  const absolute = path.join(rootDir, filePath);
  if (!existsSync(absolute)) {
    return false;
  }
  const original = readFileSync(absolute, 'utf8');
  const data = JSON.parse(original);
  const updated = transform(data);
  if (updated.changed) {
    writeFileSync(absolute, JSON.stringify(updated.value, null, 2) + '\n');
  }
  return updated.changed;
}

const updatedPackage = updateJsonFile('package.json', (data) => {
  if (data.version === rawVersion) {
    return { changed: false, value: data };
  }
  const next = { ...data, version: rawVersion };
  return { changed: true, value: next };
});

const updatedLock = updateJsonFile('package-lock.json', (data) => {
  let changed = false;
  if (data.version !== rawVersion) {
    data.version = rawVersion;
    changed = true;
  }
  if (data.packages && data.packages['']) {
    if (data.packages[''].version !== rawVersion) {
      data.packages[''].version = rawVersion;
      changed = true;
    }
  }
  return { changed, value: data };
});

const readmePath = path.join(rootDir, 'README.md');
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, 'utf8');
  const pattern = /(avinor-flight-card\.js\?v=)([^\s"']+)/;
  const nextReadme = readme.replace(pattern, (_, prefix) => `${prefix}${rawVersion}`);
  if (nextReadme !== readme) {
    writeFileSync(readmePath, nextReadme);
  }
}

if (!updatedPackage && !updatedLock) {
  console.log(`Version already set to ${rawVersion}.`);
} else {
  console.log(`Version updated to ${rawVersion}.`);
  if (!updatedLock && existsSync(path.join(rootDir, 'package-lock.json'))) {
    console.warn('package-lock.json was not updated; you may need to regenerate it manually.');
  }
}
