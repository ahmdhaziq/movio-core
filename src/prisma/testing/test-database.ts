import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { PrismaService } from '../prisma.service.js';

// Every suite gets its own schema; never truncate the developer's tables.
export function testDatabase(migrationsThrough?: string) {
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      'postgresql://movio:movio_local@127.0.0.1:5432/movio',
  );
  url.searchParams.set('schema', schema);
  const prisma = new PrismaService({ datasourceUrl: url.toString() });
  let ready = false;
  return {
    prisma,
    deploy(through?: string) {
      let temporary: string | undefined;
      try {
        let schemaPath = resolve('prisma/schema.prisma');
        if (through) {
          temporary = mkdtempSync(join(tmpdir(), 'movio-migration-'));
          schemaPath = join(temporary, 'schema.prisma');
          cpSync(resolve('prisma/schema.prisma'), schemaPath);
          for (const entry of readdirSync(resolve('prisma/migrations'))) {
            if (entry === 'migration_lock.toml' || entry <= through)
              cpSync(
                resolve('prisma/migrations', entry),
                join(temporary, 'migrations', entry),
                { recursive: true },
              );
          }
        }
        execFileSync(
          process.execPath,
          [
            resolve('node_modules/prisma/build/index.js'),
            'migrate',
            'deploy',
            '--schema',
            schemaPath,
          ],
          {
            env: { ...process.env, DATABASE_URL: url.toString() },
            stdio: 'pipe',
          },
        );
      } finally {
        if (temporary) rmSync(temporary, { recursive: true, force: true });
      }
    },
    async setup() {
      this.deploy(migrationsThrough);
      await prisma.$connect();
      ready = true;
    },
    async cleanup() {
      try {
        if (ready)
          await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await prisma.$disconnect();
      }
    },
  };
}
