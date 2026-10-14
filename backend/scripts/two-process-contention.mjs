import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';

const { Client } = pg;
const studyId = 'smoke-two-process-claim';
const ports = [3101, 3102];
const processes = [];

const database = new Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
});

function startApi(port) {
  const output = [];
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  child.output = output;
  processes.push(child);
  return child;
}

async function waitForApi(port, child) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `API process on port ${port} exited early.\n${child.output.join('')}`,
      );
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/studies/${studyId}`,
      );
      if (response.ok) {
        return;
      }
    } catch {
      // The process is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`API process on port ${port} did not become ready.`);
}

async function stopApi(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function claim(port, reviewerId) {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/studies/${studyId}/claim`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reviewerId, expectedVersion: 1 }),
    },
  );

  return { status: response.status, body: await response.json() };
}

try {
  await database.connect();
  await database.query('DELETE FROM studies WHERE id = $1', [studyId]);
  await database.query(
    `INSERT INTO studies
      (id, modality, "createdAt", status, "ownerId", "reviewNote", version, "dicomFileKey")
     VALUES ($1, 'CT', NOW(), 'Unassigned', NULL, NULL, 1, 'gradient.dcm')`,
    [studyId],
  );

  const [firstApi, secondApi] = ports.map(startApi);
  await Promise.all([
    waitForApi(ports[0], firstApi),
    waitForApi(ports[1], secondApi),
  ]);

  const results = await Promise.all([
    claim(ports[0], 'reviewer-a'),
    claim(ports[1], 'reviewer-b'),
  ]);
  const statuses = results.map(({ status }) => status).sort();

  if (statuses[0] !== 200 || statuses[1] !== 412) {
    throw new Error(`Expected statuses 200 and 412, received ${statuses}.`);
  }

  const stale = results.find(({ status }) => status === 412);
  if (stale?.body?.code !== 'STALE_VERSION') {
    throw new Error('The losing process did not return STALE_VERSION.');
  }

  console.log('Two-process contention passed: one 200 and one 412.');
} finally {
  await Promise.all(processes.map(stopApi));
  if (!database.ended) {
    await database.query('DELETE FROM studies WHERE id = $1', [studyId]);
    await database.end();
  }
}
