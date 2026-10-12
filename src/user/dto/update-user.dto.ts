import { PartialType } from '@nestjs/mapped-types';
import {
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CreateUserDto } from './create-user.dto.js';

@ValidatorConstraint({ name: 'atLeastOneField', async: false })
class AtLeastOneField implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const dto = args.object as UpdateUserDto;
    return dto.name !== undefined || dto.email !== undefined;
  }

  defaultMessage() {
    return 'At least one of name or email must be provided';
  }
}

export class UpdateUserDto extends PartialType(CreateUserDto, {
  skipNullProperties: false,
}) {
  @Validate(AtLeastOneField)
  private readonly _atLeastOneField?: never;
}
