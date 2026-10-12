import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaService } from '../prisma.service.js';

// Every suite gets its own schema; never truncate the developer's tables.
export function testDatabase() {
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
    async setup() {
      execFileSync(
        process.execPath,
        ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
        {
          env: { ...process.env, DATABASE_URL: url.toString() },
          stdio: 'pipe',
        },
      );
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
