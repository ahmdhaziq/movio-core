import { passwordFailures } from './password-policy.validator.js';
describe('Password policy', () => {
  it.each([
    'Abcdef9!',
    'A'.repeat(125) + 'b9!',
    'É'.repeat(125) + 'a9!',
    ' Aa9!xyz ',
  ])('accepts compliant boundary/Unicode/raw passwords', (password) => {
    expect(passwordFailures(password)).toEqual([]);
  });
  it.each([
    ['Abcde9!', 'PASSWORD_LENGTH_INVALID'],
    ['A'.repeat(126) + 'b9!', 'PASSWORD_LENGTH_INVALID'],
    ['abcdefg9!', 'PASSWORD_UPPERCASE_REQUIRED'],
    ['ABCDEFG9!', 'PASSWORD_LOWERCASE_REQUIRED'],
    ['Abcdefgh!', 'PASSWORD_DIGIT_REQUIRED'],
    ['Abcdefg9 ', 'PASSWORD_SYMBOL_REQUIRED'],
    ['Abcdefg٩!', 'PASSWORD_DIGIT_REQUIRED'],
  ])('identifies unmet rule for %s', (password, code) => {
    expect(passwordFailures(password).map((error) => error.code)).toContain(
      code,
    );
  });
  it('counts Unicode code points, not UTF-16 units', () => {
    expect(passwordFailures('Aa9!' + '😀'.repeat(124))).toEqual([]);
    expect(
      passwordFailures('Aa9!' + '😀'.repeat(125)).map((e) => e.code),
    ).toContain('PASSWORD_LENGTH_INVALID');
  });
});
