export type FieldType = 'string' | 'text' | 'date' | 'number' | 'boolean' | 'enum' | 'link';

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  enumValues?: string[];
  linkTarget?: string;
  hiddenFromGenericForm?: boolean;
}

export interface EntityTypeSchema {
  entityType: string;
  labelSingular: string;
  labelPlural: string;
  resource: 'DOCUMENTS' | 'MEDICAL' | 'FINANCE';
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
      'driver_license',
      'birth_certificate',
      'marriage_certificate',
      'military_id',
      'visa',
      'border_crossing',
      'residence_permit',
      'permanent_residence',
      'name_change_document',
    ],
  },
  {
    title: 'Договоры',
    types: [
      'employment_contract',
      'service_contract',
      'lease_contract',
      'sale_contract',
      'loan_contract',
    ],
  },
  {
    title: 'Акты, счета, заявления, справки',
    types: ['act_of_work', 'invoice', 'invoice_facture', 'cash_receipt', 'application', 'power_of_attorney', 'certificate'],
  },
  {
    title: 'Имущество и активы',
    types: ['real_estate', 'vehicle', 'computer', 'phone', 'tablet', 'appliance'],
  },
  {
    title: 'Финансы',
    types: ['bank', 'bank_account', 'financial_transaction', 'budget', 'financial_category', 'financial_goal', 'financial_need', 'financial_goal_contribution', 'finance_rule', 'finance_report', 'telegram_link'],
  },
  {
    title: 'ЖКХ',
    types: ['utility_meter', 'meter_reading', 'utility_bill'],
  },
  {
    title: 'Цифровые аккаунты',
    types: ['digital_account'],
  },
  {
    title: 'Прочее',
    types: ['generic_document'],
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
