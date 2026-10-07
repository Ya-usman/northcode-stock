// Modèle Excel d'import des PRODUITS — s'appuie sur le générateur commun
// (lib/import/template.ts) : onglet « Produits » (unité en menu déroulant,
// prix et quantités contrôlés, code-barres en TEXTE — sinon Excel abîme les
// EAN-13 en 5,90026E+12), « Mode d'emploi », « Listes » masquée.

import { PRODUCT_UNITS, type ImportField, type ProductUnit } from './products-import'
import { buildImportTemplate, buildImportFixFile, type TemplateColumn, type TemplateSpec } from './template'

export interface TemplateTexts {
  sheetProducts: string; sheetGuide: string; sheetLists: string
  columns: Record<ImportField, { header: string; required: boolean; help: string; example: string }>
  unitLabels: Record<ProductUnit, string>
  guideTitle: string; guideIntro: string; guideSteps: string[]
  guideColumnsTitle: string; guideColumn: string; guideRequired: string; guideMeaning: string; guideExample: string
  yes: string; no: string
  guideExamplesTitle: string; guideExamplesNote: string; examples: Partial<Record<ImportField, string | number>>[]
  guideUnitsTitle: string
  guideTipsTitle: string; guideTips: string[]
  validationTitle: string; validationUnit: string; validationNumber: string; validationInteger: string
}

const COLUMNS: { field: ImportField; width: number; validation?: TemplateColumn['validation'] }[] = [
  { field: 'name', width: 36 }, { field: 'selling_price', width: 15, validation: 'decimal' }, { field: 'buying_price', width: 15, validation: 'decimal' },
  { field: 'quantity', width: 17, validation: 'whole' }, { field: 'unit', width: 18, validation: 'list' }, { field: 'sku', width: 22, validation: 'text' },
  { field: 'low_stock_threshold', width: 17, validation: 'whole' },
]

/** Description complète du modèle produits (réutilisée par l'écran d'import commun) */
export function productsTemplateSpec(t: TemplateTexts, shopName: string): TemplateSpec {
  return {
    title: `${t.sheetProducts} — ${shopName}`,
    sheetMain: t.sheetProducts, sheetGuide: t.sheetGuide, sheetLists: t.sheetLists,
    columns: COLUMNS.map(c => ({ key: c.field, width: c.width, validation: c.validation, ...t.columns[c.field] })),
    listValues: PRODUCT_UNITS.map(u => t.unitLabels[u]), listTitle: t.guideUnitsTitle,
    guideTitle: t.guideTitle, guideIntro: t.guideIntro, guideSteps: t.guideSteps,
    guideColumnsTitle: t.guideColumnsTitle, guideColumn: t.guideColumn, guideRequired: t.guideRequired, guideMeaning: t.guideMeaning, guideExample: t.guideExample,
    yes: t.yes, no: t.no,
    guideExamplesTitle: t.guideExamplesTitle, guideExamplesNote: t.guideExamplesNote, examples: t.examples as Record<string, string | number>[],
    guideTipsTitle: t.guideTipsTitle, guideTips: t.guideTips,
    validationTitle: t.validationTitle, validationList: t.validationUnit, validationNumber: t.validationNumber, validationInteger: t.validationInteger,
  }
}

export function buildProductsTemplate(t: TemplateTexts, shopName: string): Promise<Blob> {
  return buildImportTemplate(productsTemplateSpec(t, shopName))
}

/** Lignes à corriger : mêmes colonnes + « Problème », prêtes à être réimportées */
export function buildFixFile(t: TemplateTexts, problemHeader: string, rows: { raw: Partial<Record<ImportField, unknown>>; problem: string }[]): Promise<Blob> {
  return buildImportFixFile(productsTemplateSpec(t, ''), problemHeader, rows as { raw: Record<string, unknown>; problem: string }[])
}
