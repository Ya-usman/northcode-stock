'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { NumericInput } from '@/components/ui/numeric-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DrawerSection } from '@/components/ui/app-drawer'
import { InputGroup, RequiredMark } from '@/components/ui/input-group'
import { createProductSchema, type ProductFormData } from '@/lib/validations/product'
import type { Category, Supplier } from '@/lib/types/database'
import dynamic from 'next/dynamic'
import { Camera, ScanLine, ImagePlus, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { PRODUCT_FORM_ID, PRODUCT_FORM_INTENT_ADD_ANOTHER, type ProductFormState } from '@/components/stock/product-form-submit'

const BarcodeScanner = dynamic(
  () => import('@/components/stock/barcode-scanner').then(m => ({ default: m.BarcodeScanner })),
  { ssr: false, loading: () => <div className="mt-2 h-16 rounded-xl bg-muted animate-pulse" /> }
)
import { useToast } from '@/components/ui/use-toast'
import { compressImage } from '@/lib/utils/compress-image'
import { withTimeout } from '@/lib/utils/with-timeout'
import { hasNativePhotoPicker, pickPhotoNative, PhotoPermissionError, type PhotoSource } from '@/lib/photo/pick-photo'

// Corps du panneau « Ajouter / Modifier un produit » : une carte
// « Informations principales » (nom, catégorie, prix avec devise, stock initial
// avec unité, SKU avec scanner accolé, seuil, fournisseur) et une carte
// « Options avancées » repliée (photo). Les boutons vivent dans le pied du
// FormDrawer hôte, qui soumet ce <form id="product-form"> et reçoit l'état.

interface ProductFormProps {
  categories: Category[]
  suppliers: Supplier[]
  currency: string
  isOwner: boolean
  shopId?: string
  isEdit?: boolean
  defaultValues?: Partial<ProductFormData>
  sessionCount?: number
  /** Photo restaurée après une destruction de l'activité Android pendant la prise de vue : envoyée au montage */
  initialPhoto?: File | null
  /** En édition : identifiant du produit, pour rouvrir la bonne fiche à la reprise */
  productId?: string
  /** Saisie restaurée (reprise) : considérée modifiée dès l'ouverture */
  startDirty?: boolean
  onSubmit: (data: ProductFormData) => void
  onSaveAndAdd?: (data: ProductFormData) => void
  /** Remonte l'état au panneau hôte (garde de fermeture, bouton Enregistrer) */
  onStateChange?: (state: ProductFormState) => void
}

const FieldError = ({ message }: { message?: string }) =>
  message ? <p className="text-xs text-destructive">{message}</p> : null

const UNITS = ['piece', 'kg', 'g', 'litre', 'ml', 'pack', 'carton', 'dozen', 'bag', 'bottle', 'tin', 'box']

export function ProductForm({
  categories, suppliers, currency, isOwner, shopId, isEdit,
  defaultValues, sessionCount, initialPhoto, productId, startDirty = false, onSubmit, onSaveAndAdd, onStateChange,
}: ProductFormProps) {
  const t = useTranslations()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const intentRef = useRef<string | undefined>(undefined)
  const [showScanner, setShowScanner] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string>(defaultValues?.image_url || '')
  // Options avancées ouvertes d'emblée si elles portent déjà une valeur
  const [advancedOpen, setAdvancedOpen] = useState(!!(defaultValues?.image_url || initialPhoto))
  // Chargé à la demande : le panneau hôte a déjà posé son focus avant que ce
  // formulaire existe. Sur ordinateur, le nom prend le focus au montage ; sur
  // téléphone, non (le clavier ne doit pas surgir à l'ouverture).
  const [autoFocusName] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches)

  const schema = createProductSchema({
    product_name_required: t('errors.product_name_required'),
    selling_price_required: t('errors.selling_price_required'),
    buying_price_invalid: t('errors.buying_price_invalid'),
    quantity_invalid: t('errors.quantity_invalid'),
    restock_min_qty: t('errors.restock_min_qty'),
  })

  const form = useForm<ProductFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
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
  const { errors, isDirty } = form.formState

  const dirty = startDirty || isDirty
  useEffect(() => {
    onStateChange?.({ dirty, busy: uploadingImage })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, uploadingImage])

  const NONE = '__none__'
  const unit = form.watch('unit') || 'piece'
  const categoryId = form.watch('category_id') || NONE
  const supplierId = form.watch('supplier_id') || NONE

  const handleBarcodeDetected = (code: string) => {
    form.setValue('sku', code, { shouldDirty: true })
    setShowScanner(false)
    toast({ title: t('product_form.code_scanned', { code }), variant: 'success' })
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadPhoto(file)
  }

  // Application Android/iOS : sélecteur natif (plugin Camera). La photo arrive
  // déjà réduite et, si le système détruit l'activité pendant la prise de vue,
  // la saisie mise de côté ici est rouverte avec la photo (PhotoRestoreHandler).
  // Web/PWA : les <input type="file"> cachés ci-dessous, gérés par le navigateur.
  const pick = async (source: PhotoSource) => {
    if (!shopId) return
    if (!hasNativePhotoPicker()) {
      ;(source === 'camera' ? cameraInputRef : fileInputRef).current?.click()
      return
    }
    try {
      const file = await pickPhotoNative(source, {
        kind: 'product',
        shopId,
        route: window.location.pathname,
        values: form.getValues() as unknown as Record<string, unknown>,
        meta: { isEdit: !!isEdit, productId },
      })
      if (file) await uploadPhoto(file)
    } catch (err) {
      toast({
        title: err instanceof PhotoPermissionError ? t('photo.permission_denied') : t('photo.pick_failed'),
        variant: 'destructive',
      })
    }
  }

  const uploadPhoto = async (file: File) => {
    if (!shopId) {
      toast({ title: t('product_form.missing_shop_id'), variant: 'destructive' })
      return
    }

    setUploadError(null)
    setUploadingImage(true)
    setAdvancedOpen(true)

    try {
      const compressed = await compressImage(file)
      const localUrl = URL.createObjectURL(compressed)
      setImagePreview(localUrl)

      const fd = new FormData()
      fd.append('file', compressed)
      fd.append('shop_id', shopId)
      const res = await withTimeout(fetch('/api/products/upload-image', { method: 'POST', body: fd }), 30_000)
      const json = await res.json()

      if (res.ok && json.url) {
        form.setValue('image_url', json.url, { shouldDirty: true })
        setImagePreview(json.url)
        URL.revokeObjectURL(localUrl)
      } else {
        const errMsg = json.error || t('product_form.upload_error')
        setUploadError(errMsg)
        toast({ title: t('product_form.upload_failed', { error: errMsg }), variant: 'destructive' })
        // Keep local preview so user sees what they selected
        form.setValue('image_url', '', { shouldDirty: true })
      }
    } catch (err: any) {
      const errMsg = err.message || t('toast.network_error')
      setUploadError(errMsg)
      toast({ title: t('product_form.upload_failed', { error: errMsg }), variant: 'destructive' })
      form.setValue('image_url', '', { shouldDirty: true })
    } finally {
      setUploadingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeImage = () => {
    setImagePreview('')
    setUploadError(null)
    form.setValue('image_url', '', { shouldDirty: true })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Photo restaurée après une reprise (voir PhotoRestoreHandler) : envoyée une
  // seule fois, au montage du formulaire rouvert avec la saisie d'origine.
  useEffect(() => {
    if (initialPhoto) void uploadPhoto(initialPhoto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const imageUrl = form.watch('image_url')

  // L'intention (« enregistrer et ajouter un autre ») est posée sur le <form>
  // par le pied du panneau juste avant requestSubmit ; lue puis effacée ici,
  // qu'il y ait validation réussie ou non.
  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    intentRef.current = e.currentTarget.dataset.intent
    delete e.currentTarget.dataset.intent
    void form.handleSubmit(data => {
      if (intentRef.current === PRODUCT_FORM_INTENT_ADD_ANOTHER && onSaveAndAdd) onSaveAndAdd(data)
      else onSubmit(data)
    })(e)
  }

  const optional = <span className="text-muted-foreground text-xs font-normal">({t('form.optional')})</span>

  return (
    <form id={PRODUCT_FORM_ID} onSubmit={handleFormSubmit} className="space-y-4" noValidate>

      {/* Session counter */}
      {!!sessionCount && sessionCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-sm text-green-700 dark:text-green-400 font-medium">
            {sessionCount} produit{sessionCount > 1 ? 's' : ''} ajouté{sessionCount > 1 ? 's' : ''} cette session
          </span>
        </div>
      )}

      {/* ── Informations principales ─────────────────────────────────── */}
      <DrawerSection title={t('products.section_main')}>
        <div className="space-y-1.5">
          <Label htmlFor="product-name">{t('products.name')}<RequiredMark /></Label>
          <Input id="product-name" {...form.register('name')} placeholder={t('product_form.name_placeholder')} aria-invalid={!!errors.name} autoFocus={autoFocusName} />
          <FieldError message={errors.name?.message} />
        </div>

        <div className="space-y-1.5">
          <Label>{t('products.category')} {optional}</Label>
          <Select value={categoryId} onValueChange={v => form.setValue('category_id', v === NONE ? '' : v, { shouldDirty: true })}>
            <SelectTrigger className="h-10"><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('form.none_female')}</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t('products.selling_price')}<RequiredMark /></Label>
            <Controller control={form.control} name="selling_price" render={({ field }) => (
              <InputGroup suffix={currency}>
                <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" currency={currency} className="h-10" aria-invalid={!!errors.selling_price} />
              </InputGroup>
            )} />
            <FieldError message={errors.selling_price?.message} />
          </div>
          {isOwner && (
            <div className="space-y-1.5">
              <Label>{t('products.buying_price')}</Label>
              <Controller control={form.control} name="buying_price" render={({ field }) => (
                <InputGroup suffix={currency}>
                  <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" currency={currency} className="h-10" />
                </InputGroup>
              )} />
              <FieldError message={errors.buying_price?.message} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>{t('product_form.initial_stock')}<RequiredMark /></Label>
              <Controller control={form.control} name="quantity" render={({ field }) => (
                <InputGroup suffix={unit}>
                  <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" currency={currency} className="h-10" aria-invalid={!!errors.quantity} />
                </InputGroup>
              )} />
              <FieldError message={errors.quantity?.message} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{t('products.unit')}</Label>
            <Select value={unit} onValueChange={v => form.setValue('unit', v, { shouldDirty: true })}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* SKU / Barcode, scanner accolé */}
        <div className="space-y-1.5">
          <Label htmlFor="product-sku" className="flex items-center gap-1.5">
            <ScanLine className="h-3.5 w-3.5 text-muted-foreground" />
            {t('products.sku')} {optional}
          </Label>
          <InputGroup
            action={(
              <button
                type="button"
                onClick={() => setShowScanner(v => !v)}
                aria-pressed={showScanner}
                className="inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Camera className="h-3.5 w-3.5" />
                {t('product_form.scan')}
              </button>
            )}
          >
            <Input id="product-sku" {...form.register('sku')} placeholder={t('product_form.sku_placeholder')} className="font-mono text-sm" />
          </InputGroup>
          <p className="text-[11px] text-muted-foreground">{t('product_form.scanner_hint')}</p>
          <FieldError message={errors.sku?.message} />
          {showScanner && (
            <BarcodeScanner onDetected={handleBarcodeDetected} onClose={() => setShowScanner(false)} />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>
              {t('products.low_stock_threshold')}{' '}
              <span className="text-muted-foreground text-xs font-normal">({t('form.alert_label')})</span>
            </Label>
            <Controller control={form.control} name="low_stock_threshold" render={({ field }) => (
              <NumericInput value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} placeholder="10" className="h-10" />
            )} />
            <FieldError message={errors.low_stock_threshold?.message} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('products.supplier')} {optional}</Label>
            <Select value={supplierId} onValueChange={v => form.setValue('supplier_id', v === NONE ? '' : v, { shouldDirty: true })}>
              <SelectTrigger className="h-10"><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('form.none_male')}</SelectItem>
                {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </DrawerSection>

      {/* ── Options avancées : photo ───────────────────────────────────── */}
      <DrawerSection
        title={t('dialogs.advanced_options')}
        description={t('products.section_advanced_hint')}
        collapsible
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
      >
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <ImagePlus className="h-3.5 w-3.5 text-muted-foreground" />
            {t('product_form.product_photo')} {optional}
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
                    aria-label={t('actions.remove')}
                    className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 rounded-full p-0.5 transition-colors"
                  >
                    <X className="h-3 w-3 text-white" />
                  </button>
                )}
              </div>
              <div className="text-xs space-y-1 pt-1">
                {uploadingImage && <p className="text-muted-foreground">{t('product_form.uploading')}</p>}
                {!uploadingImage && imageUrl && <p className="text-green-500">{t('product_form.photo_saved')}</p>}
                {!uploadingImage && uploadError && (
                  <div className="flex items-start gap-1 text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{uploadError}</span>
                  </div>
                )}
                {!uploadingImage && uploadError && (
                  <p className="text-muted-foreground text-[11px]">{t('product_form.bucket_hint')}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => pick('camera')}
                disabled={!shopId || uploadingImage}
                className="flex-1 h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Camera className="h-5 w-5" />
                <span className="text-xs">{t('product_form.take_photo')}</span>
              </button>
              <button
                type="button"
                onClick={() => pick('gallery')}
                disabled={!shopId || uploadingImage}
                className="flex-1 h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ImagePlus className="h-5 w-5" />
                <span className="text-xs">{t('product_form.choose_photo')}</span>
              </button>
            </div>
          )}

          {/* Camera capture (Android: opens camera directly) */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleImageSelect}
          />
          {/* Gallery / file picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleImageSelect}
          />
        </div>
      </DrawerSection>
    </form>
  )
}
