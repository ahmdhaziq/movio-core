import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UserIdParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  id!: number;
}
