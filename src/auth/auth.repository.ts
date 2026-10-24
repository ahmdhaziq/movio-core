import type { CreateRefreshTokenDto } from './dto/create-refresh-token.dto.js';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateAuthIdentityDto,
  IdentityMetadata,
} from './dto/create-auth-identity.dto.js';
const metadata = {
  id: true,
  identity_id: true,
  user_id: true,
  provider: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
} satisfies Prisma.AuthIdentitySelect;
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}
  withTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(work);
  }

  findLocalCredentialsByEmail(email: string) {
    return this.prisma.authIdentity.findFirst({
      where: { provider: 'local', user: { email } },
      select: {
        id: true,
        user_id: true,
        deleted_at: true,
        password_hash: true,
        user: {
          select: { id: true, name: true, email: true, deleted_at: true },
        },
      },
    });
  }
  findActiveOwner(
    userId: number,
    identityId: number,
    tx?: Prisma.TransactionClient,
  ) {
    return (tx ?? this.prisma).authIdentity.findFirst({
      where: {
        id: identityId,
        user_id: userId,
        provider: 'local',
        deleted_at: null,
        user: { deleted_at: null },
      },
      select: {
        id: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }
  createRefreshToken(dto: CreateRefreshTokenDto, tx: Prisma.TransactionClient) {
    return tx.refreshToken.create({ data: dto });
  }

  findRefreshTokenById(id: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).refreshToken.findUnique({ where: { id } });
  }
  async lockRefreshRoot(rootId: string, tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT "id" FROM "refresh_token" WHERE "id" = ${rootId}::uuid FOR UPDATE`;
    return this.findRefreshTokenById(rootId, tx);
  }
  async consumeRefreshToken(
    id: string,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await tx.refreshToken.updateMany({
      where: {
        id,
        consumed_at: null,
        revoked_at: null,
        expired_at: { gt: now },
      },
      data: { consumed_at: now },
    });
    return result.count;
  }
  async revokeRefreshFamily(
    rootId: string,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const result = await tx.refreshToken.updateMany({
      where: { root_token_id: rootId },
      data: { revoked_at: now },
    });
    if (result.count < 1)
      throw new Error('Refresh family disappeared during transaction');
  }

  createIdentity(
    dto: CreateAuthIdentityDto,
    tx: Prisma.TransactionClient,
  ): Promise<IdentityMetadata> {
    return tx.authIdentity.create({
      data: {
        identity_id: dto.identity_id,
        user_id: dto.user_id,
        provider: dto.provider,
        password_hash: dto.password_hash,
      },
      select: metadata,
    });
  }

  getIdentityByUserId(
    userId: number,
    provider?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<IdentityMetadata[]> {
    return (tx ?? this.prisma).authIdentity.findMany({
      where: {
        user_id: userId,
        ...(provider === undefined ? {} : { provider }),
      },
      select: metadata,
      orderBy: { id: 'asc' },
    });
  }
}
