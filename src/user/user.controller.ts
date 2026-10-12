import { Controller, Get, Param, Query } from '@nestjs/common';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UserIdParamsDto } from './dto/user-id-params.dto.js';
import { UserService } from './user.service.js';

@Controller('user')
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get('list')
  getUsers(@Query() query: ListUsersQueryDto) {
    return this.service.getUsers(query.page, query.perPage);
  }

  @Get(':id')
  getUserById(@Param() params: UserIdParamsDto) {
    return this.service.getUserById(params.id);
  }
}
