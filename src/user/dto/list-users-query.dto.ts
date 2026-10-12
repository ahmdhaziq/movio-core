import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ListUsersQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  perPage = 10;
}
