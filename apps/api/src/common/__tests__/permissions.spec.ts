import { roleAllows } from '../permissions';

describe('Ролевая матрица прав (permissions.ts)', () => {
  it('владельцу разрешено всё, включая просмотр строго конфиденциальных данных', () => {
    expect(roleAllows('OWNER', 'CONFIDENTIAL', 'VIEW')).toBe(true);
    expect(roleAllows('OWNER', 'FINANCE', 'EDIT')).toBe(true);
    expect(roleAllows('OWNER', 'USERS', 'MANAGE')).toBe(true);
  });

  it('ребёнку запрещён доступ к финансам', () => {
    expect(roleAllows('CHILD', 'FINANCE', 'VIEW')).toBe(false);
    expect(roleAllows('CHILD', 'FINANCE', 'EDIT')).toBe(false);
  });

  it('ребёнку разрешён только просмотр документов, но не редактирование', () => {
    expect(roleAllows('CHILD', 'DOCUMENTS', 'VIEW')).toBe(true);
    expect(roleAllows('CHILD', 'DOCUMENTS', 'EDIT')).toBe(false);
  });

  it('гостю запрещено почти всё, кроме общего просмотра', () => {
    expect(roleAllows('GUEST', 'GENERAL', 'VIEW')).toBe(true);
    expect(roleAllows('GUEST', 'DOCUMENTS', 'VIEW')).toBe(false);
    expect(roleAllows('GUEST', 'MEDICAL', 'VIEW')).toBe(false);
  });

  it('партнёру разрешена медицина и финансы, но не управление интеграциями', () => {
    expect(roleAllows('PARTNER', 'MEDICAL', 'EDIT')).toBe(true);
    expect(roleAllows('PARTNER', 'FINANCE', 'EDIT')).toBe(true);
    expect(roleAllows('PARTNER', 'INTEGRATIONS', 'CREATE')).toBe(false);
  });

  it('взрослому члену семьи разрешено читать финансы, но не редактировать', () => {
    expect(roleAllows('ADULT', 'FINANCE', 'VIEW')).toBe(true);
    expect(roleAllows('ADULT', 'FINANCE', 'EDIT')).toBe(false);
  });
});
