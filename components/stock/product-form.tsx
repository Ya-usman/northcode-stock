'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumericInput } from '@/components/ui/numeric-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogFooter } from '@/components/ui/dialog'
import { productSchema, type ProductFormData } from '@/lib/validations/product'
import type { Product, Category, Supplier } from '@/lib/types/database'

interface ProductFormProps {
  categories: Category[]
  suppliers: Supplier[]
  currency: string
  isOwner: boolean
  isEdit?: boolean
  defaultValues?: Partial<ProductFormData>
  saving: boolean
  onSubmit: (data: ProductFormData) => void
  onCancel: () => void
}

export function ProductForm({
  categories, suppliers, currency, isOwner, isEdit,
  defaultValues, saving, onSubmit, onCancel,
}: ProductFormProps) {
  const t = useTranslations()

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      name_hausa: '',
      unit: 'piece',
      category_id: '',
      supplier_id: '',
      buying_price: 0,
      selling_price: 0,
      quantity: 0,
      low_stock_threshold: undefined,
      ...defaultValues,
    },
  })

  const NONE = '__none__'
  const unit = form.watch('unit') || 'piece'
  const categoryId = form.watch('category_id') || NONE
  const supplierId = form.watch('supplier_id') || NONE

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 overflow-y-auto max-h-[70vh] pr-1">
      <div className="grid grid-cols-2 gap-3">

        <div className="col-span-2 space-y-1">
          <Label>{t('products.name')} *</Label>
          <Input {...form.register('name')} placeholder={t('products.name')} />
          {form.formState.errors.name && (
            <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div className="col-span-2 space-y-1">
          <Label>
            {t('products.name_hausa')}{' '}
            <span className="text-muted-foreground text-xs font-normal">({t('form.optional')})</span>
          </Label>
          <Input {...form.register('name_hausa')} placeholder={t('products.name_hausa')} />
        </div>

        <div className="space-y-1">
          <Label>{t('products.unit')}</Label>
          <Select value={unit} onValueChange={v => form.setValue('unit', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['piece', 'kg', 'g', 'litre', 'ml', 'pack', 'carton', 'dozen', 'bag', 'bottle', 'tin', 'box'].map(u => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>
            {t('products.category')}{' '}
            <span className="text-muted-foreground text-xs font-normal">({t('form.optional')})</span>
          </Label>
          <Select value={categoryId} onValueChange={v => form.setValue('category_id', v === NONE ? '' : v)}>
            <SelectTrigger><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('form.none_female')}</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>
            {t('products.supplier')}{' '}
            <span className="text-muted-foreground text-xs font-normal">({t('form.optional')})</span>
          </Label>
          <Select value={supplierId} onValueChange={v => form.setValue('supplier_id', v === NONE ? '' : v)}>
            <SelectTrigger><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('form.none_male')}</SelectItem>
              {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isOwner && (
          <div className="space-y-1">
            <Label>
              {t('products.buying_price')}{' '}
              <span className="text-muted-foreground text-xs">({currency})</span>
            </Label>
            <Controller control={form.control} name="buying_price" render={({ field }) => (
              <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" />
            )} />
            {form.formState.errors.buying_price && (
              <p className="text-xs text-destructive">{form.formState.errors.buying_price.message}</p>
            )}
          </div>
        )}

        <div className="space-y-1">
          <Label>
            {t('products.selling_price')} *{' '}
            <span className="text-muted-foreground text-xs">({currency})</span>
          </Label>
          <Controller control={form.control} name="selling_price" render={({ field }) => (
            <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" />
          )} />
          {form.formState.errors.selling_price && (
            <p className="text-xs text-destructive">{form.formState.errors.selling_price.message}</p>
          )}
        </div>

        {!isEdit && (
          <div className="space-y-1">
            <Label>{t('products.quantity')} *</Label>
            <Controller control={form.control} name="quantity" render={({ field }) => (
              <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" />
            )} />
            {form.formState.errors.quantity && (
              <p className="text-xs text-destructive">{form.formState.errors.quantity.message}</p>
            )}
          </div>
        )}

        <div className="space-y-1">
          <Label>
            {t('products.low_stock_threshold')}{' '}
            <span className="text-muted-foreground text-xs font-normal">({t('form.alert_label')})</span>
          </Label>
          <Controller control={form.control} name="low_stock_threshold" render={({ field }) => (
            <NumericInput value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} placeholder="10" />
          )} />
        </div>

      </div>

      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
        <Button type="submit" disabled={saving} className="bg-blue-600 dark:bg-blue-500">
          {saving ? t('actions.saving') : isEdit ? t('actions.update') : t('actions.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}
