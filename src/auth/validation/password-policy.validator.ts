import { registerDecorator } from 'class-validator';
const rules = [
  {
    code: 'PASSWORD_LENGTH_INVALID',
    message: 'Password must contain 8–128 characters',
    valid: (v: string) => {
      const length = Array.from(v).length;
      return length >= 8 && length <= 128;
    },
  },
  {
    code: 'PASSWORD_UPPERCASE_REQUIRED',
    message: 'Password must include an uppercase letter',
    valid: (v: string) => /\p{Lu}/u.test(v),
  },
  {
    code: 'PASSWORD_LOWERCASE_REQUIRED',
    message: 'Password must include a lowercase letter',
    valid: (v: string) => /\p{Ll}/u.test(v),
  },
  {
    code: 'PASSWORD_DIGIT_REQUIRED',
    message: 'Password must include a digit',
    valid: (v: string) => /[0-9]/u.test(v),
  },
  {
    code: 'PASSWORD_SYMBOL_REQUIRED',
    message: 'Password must include a symbol',
    valid: (v: string) => /[^\p{L}\p{N}\s]/u.test(v),
  },
];
export function passwordFailures(
  value: unknown,
): { code: string; message: string }[] {
  if (typeof value !== 'string') return [];
  return rules
    .filter((rule) => !rule.valid(value))
    .map(({ code, message }) => ({ code, message }));
}
export function PasswordPolicy(): PropertyDecorator {
  return (target, property) => {
    for (const rule of rules)
      registerDecorator({
        name: rule.code,
        target: target.constructor,
        propertyName: String(property),
        validator: {
          validate: (value: unknown) =>
            typeof value !== 'string' || rule.valid(value),
          defaultMessage: () => rule.message,
        },
      });
  };
}
