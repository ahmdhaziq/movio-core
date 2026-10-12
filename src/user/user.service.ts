import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserRepository } from './user.repository.js';

@Injectable()
export class UserService {
  constructor(private readonly repository: UserRepository) {}

  async delete(id: number) {
    if (!(await this.getUser({ id, deleted_at: null })))
      throw new NotFoundException('User not found');
    try {
      const user = await this.repository.softDelete(id);
      if (!user) throw new NotFoundException('User not found');
      return user;
    } catch (error) {
      this.translateError(error);
    }
  }

  // Internal calls do not pass through Nest's HTTP ValidationPipe.
  private async validateDto<T extends object>(
    type: ClassConstructor<T>,
    input: T,
  ) {
    const dto = plainToInstance(type, input);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length)
      throw new BadRequestException(
        errors.flatMap((error) => Object.values(error.constraints ?? {})),
      );
    return dto;
  }

  async update(id: number, query: UpdateUserDto) {
    const dto = await this.validateDto(UpdateUserDto, query);
    try {
      const user = await this.repository.update(id, dto);
      if (!user) throw new NotFoundException('User not found');
      return user;
    } catch (error) {
      this.translateError(error);
    }
  }

  async getUsers(page = 1, perPage = 10) {
    const skip = (page - 1) * perPage;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isInteger(perPage) ||
      perPage < 1 ||
      perPage > 50 ||
      !Number.isSafeInteger(skip)
    ) {
      throw new BadRequestException('Invalid pagination');
    }
    const users = await this.repository.getUsers(skip, perPage);
    if (!users.length) throw new NotFoundException('No users found');
    return users;
  }

  async getUserById(id: number) {
    const user = await this.repository.getUserById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  getUser(where: Prisma.UserWhereUniqueInput) {
    return this.repository.getUser(where);
  }

  async create(dto: CreateUserDto) {
    dto = await this.validateDto(CreateUserDto, dto);
    if (await this.getUser({ email: dto.email })) {
      throw new ConflictException('Email is already in use');
    }
    try {
      return await this.repository.create(dto);
    } catch (error) {
      this.translateError(error);
    }
  }

  private translateError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002')
        throw new ConflictException('Email is already in use');
      if (error.code === 'P2025') throw new NotFoundException('User not found');
    }
    throw error;
  }
}
