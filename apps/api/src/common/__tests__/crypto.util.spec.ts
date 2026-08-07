process.env.TWO_FACTOR_ENC_KEY = 'a'.repeat(64); // 32-байтовый hex-ключ для теста
import { encryptSecret, decryptSecret, hashToken } from '../crypto.util';

describe('Шифрование TOTP-секрета (crypto.util.ts)', () => {
  it('шифрует и расшифровывает секрет без потерь', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toEqual(secret);
    expect(decryptSecret(encrypted)).toEqual(secret);
  });

  it('шифрование не детерминировано (разные IV на каждый вызов)', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(a).not.toEqual(b);
    expect(decryptSecret(a)).toEqual(secret);
    expect(decryptSecret(b)).toEqual(secret);
  });

  it('hashToken детерминирован и необратим по построению (sha256)', () => {
    const token = 'refresh-token-example';
    expect(hashToken(token)).toEqual(hashToken(token));
    expect(hashToken(token)).toHaveLength(64);
  });

  it('повреждённый шифротекст не расшифровывается', () => {
    const encrypted = encryptSecret('secret-value');
    const tampered = encrypted.slice(0, -2) + '00';
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
