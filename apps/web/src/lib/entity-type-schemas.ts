export type FieldType = 'string' | 'text' | 'date' | 'number' | 'boolean' | 'enum' | 'link';

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  enumValues?: string[];
  linkTarget?: string;
}

export interface EntityTypeSchema {
  entityType: string;
  labelSingular: string;
  labelPlural: string;
  resource: 'DOCUMENTS' | 'MEDICAL';
  fields: FieldSchema[];
  childTypes?: string[];
  hierarchical?: boolean;
}

/**
 * Группировка типов для навигации — чисто UI-слой, сама схема полей
 * приходит с backend через /entity-types (единый источник правды).
 */
export const DOCUMENT_TYPE_GROUPS: { title: string; types: string[] }[] = [
  {
    title: 'Документы личности',
    types: [
      'passport_rf',
      'snils',
      'inn',
      'foreign_passport',
      'visa',
      'border_crossing',
      'residence_permit',
      'permanent_residence',
      'name_change_document',
    ],
  },
  {
    title: 'Имущество и активы',
    types: ['real_estate', 'vehicle', 'computer', 'phone', 'tablet', 'appliance'],
  },
  {
    title: 'Цифровые аккаунты',
    types: ['digital_account'],
  },
];

export const MEDICAL_TYPE_GROUPS: { title: string; types: string[] }[] = [
  {
    title: 'Медицинские записи',
    types: ['medical_organization', 'doctor', 'medical_visit', 'lab_result', 'medical_conclusion', 'prescription', 'vaccination'],
  },
  {
    title: 'Лекарства и аптечки',
    types: ['medication', 'first_aid_kit', 'first_aid_kit_item'],
  },
];
