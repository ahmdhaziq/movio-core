import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

const publicProfile = {
  id: true,
  name: true,
  created_at: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  softDelete(id: number) {
    return this.prisma.user.update({
      where: { id, deleted_at: null },
      data: { deleted_at: new Date() },
    });
  }

  update(id: number, query: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id, deleted_at: null },
      data: { name: query.name, email: query.email },
    });
  }

  getUserById(id: number) {
    return this.prisma.user.findUnique({
      where: { id, deleted_at: null },
      select: publicProfile,
    });
  }

  getUsers(skip: number, perPage: number) {
    return this.prisma.user.findMany({
      where: { deleted_at: null },
      select: publicProfile,
      orderBy: { id: 'asc' },
      skip,
      take: perPage,
    });
  }

  getUser(where: Prisma.UserWhereUniqueInput, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).user.findUnique({ where });
  }

  create(dto: CreateUserDto, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).user.create({
      data: { name: dto.name, email: dto.email },
    });
  }
}
