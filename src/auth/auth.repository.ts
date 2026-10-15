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
