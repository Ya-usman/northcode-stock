'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumericInput } from '@/components/ui/numeric-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogFooter } from '@/components/ui/dialog'
import { productSchema, type ProductFormData } from '@/lib/validations/product'
import type { Category, Supplier } from '@/lib/types/database'
import { BarcodeScanner } from '@/components/stock/barcode-scanner'
import { Camera, ScanLine, ImagePlus, X, Loader2, AlertCircle } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { compressImage } from '@/lib/utils/compress-image'

interface ProductFormProps {
  categories: Category[]
  suppliers: Supplier[]
  currency: string
  isOwner: boolean
  shopId?: string
  isEdit?: boolean
  defaultValues?: Partial<ProductFormData>
  saving: boolean
  onSubmit: (data: ProductFormData) => void
  onCancel: () => void
}

export function ProductForm({
  categories, suppliers, currency, isOwner, shopId, isEdit,
  defaultValues, saving, onSubmit, onCancel,
}: ProductFormProps) {
  const t = useTranslations()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string>(defaultValues?.image_url || '')

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
      sku: '',
      image_url: '',
      ...defaultValues,
    },
  })

  const NONE = '__none__'
  const unit = form.watch('unit') || 'piece'
  const categoryId = form.watch('category_id') || NONE
  const supplierId = form.watch('supplier_id') || NONE

  const handleBarcodeDetected = (code: string) => {
    form.setValue('sku', code)
    setShowScanner(false)
    toast({ title: `Code scanné : ${code}`, variant: 'success' })
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!shopId) {
      toast({ title: 'shop_id manquant — impossible d\'uploader', variant: 'destructive' })
      return
    }

    setUploadError(null)
    setUploadingImage(true)

    try {
      const compressed = await compressImage(file)
      const localUrl = URL.createObjectURL(compressed)
      setImagePreview(localUrl)

      const fd = new FormData()
      fd.append('file', compressed)
      fd.append('shop_id', shopId)
      const res = await fetch('/api/products/upload-image', { method: 'POST', body: fd })
      const json = await res.json()

      if (res.ok && json.url) {
        form.setValue('image_url', json.url)
        setImagePreview(json.url)
        URL.revokeObjectURL(localUrl)
      } else {
        const errMsg = json.error || 'Erreur upload'
        setUploadError(errMsg)
        toast({ title: `Upload échoué : ${errMsg}`, variant: 'destructive' })
        // Keep local preview so user sees what they selected
        form.setValue('image_url', '')
      }
    } catch (err: any) {
      const errMsg = err.message || 'Erreur réseau'
      setUploadError(errMsg)
      toast({ title: `Upload échoué : ${errMsg}`, variant: 'destructive' })
      form.setValue('image_url', '')
    } finally {
      setUploadingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeImage = () => {
    setImagePreview('')
    setUploadError(null)
    form.setValue('image_url', '')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const imageUrl = form.watch('image_url')

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 overflow-y-auto max-h-[75vh] px-1">
      <div className="grid grid-cols-2 gap-3">

        {/* Name */}
        <div className="col-span-2 space-y-1">
          <Label>{t('products.name')} *</Label>
          <Input {...form.register('name')} placeholder={t('products.name')} />
          {form.formState.errors.name && (
            <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
          )}
        </div>

        {/* Unit */}
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

        {/* Category */}
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

        {/* Supplier */}
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

        {/* Buying price */}
        {isOwner && (
          <div className="space-y-1">
            <Label>
              {t('products.buying_price')}{' '}
              <span className="text-muted-foreground text-xs">({currency})</span>
            </Label>
            <Controller control={form.control} name="buying_price" render={({ field }) => (
              <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" currency={currency} />
            )} />
          </div>
        )}

        {/* Selling price */}
        <div className="space-y-1">
          <Label>
            {t('products.selling_price')} *{' '}
            <span className="text-muted-foreground text-xs">({currency})</span>
          </Label>
          <Controller control={form.control} name="selling_price" render={({ field }) => (
            <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" currency={currency} />
          )} />
          {form.formState.errors.selling_price && (
            <p className="text-xs text-destructive">{form.formState.errors.selling_price.message}</p>
          )}
        </div>

        {/* Quantity */}
        {!isEdit && (
          <div className="space-y-1">
            <Label>{t('products.quantity')} *</Label>
            <Controller control={form.control} name="quantity" render={({ field }) => (
              <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" currency={currency} />
            )} />
          </div>
        )}

        {/* Low stock */}
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

      {/* ── SKU / Barcode ───────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="flex items-center gap-1.5">
          <ScanLine className="h-3.5 w-3.5 text-muted-foreground" />
          SKU / Code-barres
          <span className="text-muted-foreground text-xs font-normal">({t('form.optional')})</span>
        </Label>
        <div className="flex gap-2">
          <Input
            {...form.register('sku')}
            placeholder="Ex : 6001234567890"
            className="font-mono text-sm flex-1"
          />
          <button
            type="button"
            onClick={() => setShowScanner(v => !v)}
            className="h-9 px-3 flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg bg-muted hover:bg-accent transition-colors shrink-0"
          >
            <Camera className="h-3.5 w-3.5" />
            Scan
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Scanner Bluetooth/USB : cliquez dans le champ et scannez directement.
        </p>

        {showScanner && (
          <BarcodeScanner
            onDetected={handleBarcodeDetected}
            onClose={() => setShowScanner(false)}
          />
        )}
      </div>

      {/* ── Photo ──────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <ImagePlus className="h-3.5 w-3.5 text-muted-foreground" />
          Photo du produit
          <span className="text-muted-foreground text-xs font-normal">({t('form.optional')})</span>
        </Label>

        {imagePreview ? (
          <div className="flex items-start gap-3">
            <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border group shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Aperçu" className="w-full h-full object-cover" />
              {uploadingImage && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 text-white animate-spin" />
                </div>
              )}
              {!uploadingImage && (
                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 rounded-full p-0.5 transition-colors"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              )}
            </div>
            <div className="text-xs space-y-1 pt-1">
              {uploadingImage && <p className="text-muted-foreground">Upload en cours…</p>}
              {!uploadingImage && imageUrl && <p className="text-green-500">Photo enregistrée ✓</p>}
              {!uploadingImage && uploadError && (
                <div className="flex items-start gap-1 text-red-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}
              {!uploadingImage && uploadError && (
                <p className="text-muted-foreground text-[11px]">
                  Vérifiez que le bucket "product-images" existe dans Supabase Storage.
                </p>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => shopId && fileInputRef.current?.click()}
            disabled={!shopId || uploadingImage}
            className="w-full h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ImagePlus className="h-5 w-5" />
            <span className="text-xs">Choisir une photo</span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleImageSelect}
        />
      </div>

      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
        <Button type="submit" disabled={saving || uploadingImage} className="bg-blue-600 dark:bg-blue-500">
          {saving ? t('actions.saving') : isEdit ? t('actions.update') : t('actions.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}
