'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocale, useTranslations } from 'next-intl'
import { PACK_UNITS, packToBase, packPriceToUnit } from '@/lib/products/packaging'
import { MAX_TIERS, tierPresets } from '@/lib/products/price-tiers'
import { FINE_FACTOR, isFineUnit } from '@/lib/products/sale-measures'
import { SaleMeasuresField, type MeasureRow } from '@/components/stock/sale-measures-field'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { NumericInput } from '@/components/ui/numeric-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DrawerSection } from '@/components/ui/app-drawer'
import { InputGroup, RequiredMark } from '@/components/ui/input-group'
import { createProductSchema, type ProductFormData } from '@/lib/validations/product'
import type { Category, Supplier } from '@/lib/types/database'
import dynamic from 'next/dynamic'
import { Camera, ScanLine, ImagePlus, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { PRODUCT_FORM_ID, type ProductFormState } from '@/components/stock/product-form-submit'

const BarcodeScanner = dynamic(
  () => import('@/components/stock/barcode-scanner').then(m => ({ default: m.BarcodeScanner })),
  { ssr: false, loading: () => <div className="mt-2 h-16 rounded-xl bg-muted animate-pulse" /> }
)
import { useToast } from '@/components/ui/use-toast'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { ExpiryDateField, usePastExpiryConfirm } from '@/components/stock/expiry-date-field'
import { classifyBarcode } from '@/lib/products/barcode'
import { PRODUCT_UNITS, SKU_MAX_LENGTH } from '@/lib/import/products-import'
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
  /** « Stock : modification » : prix d'achat visible et modifiable */
  fullRights: boolean
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
  /** La page décide quoi faire après (fermer, ou vider pour un autre produit). Peut renvoyer
   *  une erreur de champ du serveur (ex. code-barres déjà pris) : affichée sous le champ. */
  onSubmit: (data: ProductFormData) => void | Promise<void | ProductFieldError | boolean>
  /** Remonte l'état au panneau hôte (garde de fermeture, bouton Enregistrer) */
  onStateChange?: (state: ProductFormState) => void
  /** Seuil d'alerte de la boutique : rappelé en grisé dans la case « Seuil » laissée vide */
  shopLowStockThreshold?: number | null
  /** Produit suivi par numéro de série (modification) : vendu à l'unité, pas de mesure de vente */
  trackSerials?: boolean
}

/** Champs de « Plus d'options » : une erreur sur l'un d'eux ouvre la section */
const MORE_FIELDS: string[] = ['category_id', 'sku', 'low_stock_threshold', 'supplier_id', 'location', 'price_tiers', 'pack_unit', 'pack_units', 'pack_barcode', 'sale_measures']

/** Erreur renvoyée par le serveur pour un champ précis du formulaire */
export type ProductFieldError = { field: 'sku' | 'name' | 'selling_price' | 'buying_price' | 'quantity' | 'unit' | 'location' | 'low_stock_threshold' | 'expiry_date' | 'price_tiers' | 'sale_measures'; message: string }

/** Nombre à virgule (stock de départ en kg ou en litres) : « 37,5 » ou « 37.5 » ; vide = 0 */
function DecimalInput({ value, onChange, onBlur, className, ...props }: { value: number; onChange: (v: number) => void; onBlur?: () => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [text, setText] = useState(value ? String(value).replace('.', ',') : '')
  useEffect(() => {
    const cur = Number(text.replace(',', '.')) || 0
    if (Math.abs(cur - value) > 1e-9) setText(value ? String(value).replace('.', ',') : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <Input type="text" inputMode="decimal" value={text} placeholder="0" className={className} onBlur={onBlur} {...props}
      onChange={e => {
        const raw = e.target.value.replace(/[^\d.,]/g, '').replace('.', ',')
        const [a, ...b] = raw.split(',')
        const clean = b.length ? `${a},${b.join('').slice(0, 3)}` : a
        setText(clean)
        onChange(Number(clean.replace(',', '.')) || 0)
      }} />
  )
}

const FieldError = ({ message }: { message?: string }) =>
  message ? <p className="text-xs text-destructive">{message}</p> : null

// Liste unique des unités (même liste que l'import et l'ajout rapide)
const UNITS = PRODUCT_UNITS

export function ProductForm({
  categories, suppliers, currency, fullRights, shopId, isEdit,
  defaultValues, sessionCount, initialPhoto, productId, startDirty = false, onSubmit, onStateChange, shopLowStockThreshold, trackSerials,
}: ProductFormProps) {
  const t = useTranslations()
  const unitLabel = useUnitLabel()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string>(defaultValues?.image_url || '')
  // « Plus d'options » ouvertes d'emblée si l'un de leurs champs porte déjà une valeur
  const [moreOpen, setMoreOpen] = useState(() => !!(defaultValues?.category_id || defaultValues?.sku || defaultValues?.supplier_id || defaultValues?.location
    || (defaultValues?.low_stock_threshold !== undefined && defaultValues?.low_stock_threshold !== null)
    || (Array.isArray(defaultValues?.price_tiers) && defaultValues!.price_tiers!.length > 0)
    || (!isFineUnit(defaultValues?.unit) && Array.isArray(defaultValues?.sale_measures) && defaultValues!.sale_measures!.length > 0)))
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
    wholesale_incomplete: t('wholesale.error_incomplete'),
    wholesale_not_below_retail: t('wholesale.error_not_below_retail'),
    wholesale_min_invalid: t('wholesale.error_min'),
    wholesale_order: t('wholesale.error_order'),
    wholesale_price_invalid: t('wholesale.error_price'),
    pack_units_invalid: t('wholesale.error_pack_units'),
    measures: {
      invalid: t('measures.error_invalid'), too_many: t('measures.error_too_many'), incomplete: t('measures.error_incomplete'),
      key: t('measures.error_key'), label: t('measures.error_label'), price: t('measures.error_price'),
      units: t('measures.error_units', { unit: unitLabel(defaultValues?.unit || 'piece', 2) }), duplicate: t('measures.error_duplicate'),
      fixed: t('measures.error_fixed'),
    },
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
      expiry_date: '',
      location: '',
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
  // Vente en gros et colis : exemples calculés en direct (rien n'est enregistré tant qu'on n'envoie pas)
  const locale = useLocale()
  const money = (n: number) => `${Math.round(n).toLocaleString(locale)} ${currency}`
  const packUnit = form.watch('pack_unit') || ''
  const packUnits = Number(form.watch('pack_units')) || 0
  const retailNow = Number(form.watch('selling_price')) || 0
  // Paliers : au moins une ligne affichée (vide = pas de prix de gros)
  const tierValues = (form.watch('price_tiers') as { min_qty?: number | null; price?: number | null }[] | null | undefined) || []
  const tierRows = tierValues.length ? tierValues : [{ min_qty: null, price: null }]
  const writeTiers = (rows: { min_qty?: number | null; price?: number | null }[]) => form.setValue('price_tiers', rows as any, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
  const setTier = (i: number, patch: { min_qty?: number | null; price?: number | null }) => writeTiers(tierRows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addTier = () => { if (tierRows.length < MAX_TIERS) writeTiers([...tierRows, { min_qty: null, price: null }]) }
  const removeTier = (i: number) => writeTiers(tierRows.length > 1 ? tierRows.filter((_, j) => j !== i) : [{ min_qty: null, price: null }])
  // Quantité tout prête : posée sur le premier palier sans quantité, sinon sur un nouveau palier
  const applyPreset = (qty: number) => {
    const i = tierRows.findIndex(r => !r.min_qty)
    if (i >= 0) setTier(i, { min_qty: qty })
    else if (tierRows.length < MAX_TIERS) writeTiers([...tierRows, { min_qty: qty, price: null }])
  }
  const tierExample = (r: { min_qty?: number | null; price?: number | null }) => {
    const w = Number(r.price) || 0, m = Number(r.min_qty) || 0
    return w > 0 && m >= 2 && retailNow > 0 && w < retailNow
      ? t('wholesale.example', { min: m, unit: unitLabel(unit, m), total: money(w * m), normal: money(retailNow * m), price: money(w), percent: Math.round((1 - w / retailNow) * 100) })
      : null
  }
  const optional = <span className="text-muted-foreground text-xs font-normal">({t('form.optional')})</span>
  // Mesures de vente (203). Produit en grammes ou en millilitres : stock et prix saisis au kilo ou au litre (convertis ici,
  // la base garde des grammes entiers), mesures en tête du formulaire, ni paliers de gros ni colis (les mesures les remplacent)
  const fine = isFineUnit(unit)
  const coarse = unit === 'ml' ? 'litre' : 'kg'
  const measureRows = (form.watch('sale_measures') as MeasureRow[] | null | undefined) || []
  const writeMeasures = (rows: MeasureRow[]) => form.setValue('sale_measures', rows as any, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
  const toCoarsePrice = (v: unknown) => Math.round((Number(v) || 0) * FINE_FACTOR * 100) / 100
  const changeUnit = (next: string) => {
    const was = isFineUnit(unit), now = isFineUnit(next)
    if (was !== now) {
      // Les nombres affichés restent ceux que la personne a tapés : seule leur unité de stockage change
      const k = now ? 1 / FINE_FACTOR : FINE_FACTOR
      const v = form.getValues()
      form.setValue('selling_price', Number(v.selling_price) ? Number(v.selling_price) * k : v.selling_price, { shouldDirty: true })
      form.setValue('buying_price', Number(v.buying_price) ? Number(v.buying_price) * k : v.buying_price, { shouldDirty: true })
      if (!isEdit) form.setValue('quantity', Math.round((Number(v.quantity) || 0) / k), { shouldDirty: true })
      if (now) { form.setValue('price_tiers', null, { shouldDirty: true }); form.setValue('pack_unit', '', { shouldDirty: true }) }
    }
    form.setValue('unit', next, { shouldDirty: true })
  }
  const measuresBlock = (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid="product-measures-block">
      <p className="text-sm font-medium">{t('measures.title')} {fine ? null : optional}</p>
      <SaleMeasuresField rows={measureRows} onChange={writeMeasures} unit={unit} currency={currency}
        error={(errors as any).sale_measures?.message} disabled={!!trackSerials} />
      {fine && measureRows.some(r => r.key) && <p className="text-xs text-muted-foreground" data-testid="product-measures-only">{t('measures.only_measures')}</p>}
    </div>
  )
  const inPacks = !isEdit && !!form.watch('initial_in_packs') && packUnits >= 2
  const qtyNow = Number(form.watch('quantity')) || 0
  const buyNow = Number(form.watch('buying_price')) || 0
  const packConversion = inPacks && qtyNow > 0
    ? t(buyNow > 0 && fullRights ? 'wholesale.pack_conversion_price' : 'wholesale.pack_conversion', { packs: qtyNow, pack: unitLabel(packUnit, qtyNow), total: packToBase(qtyNow, packUnits), unit: unitLabel(unit, packToBase(qtyNow, packUnits)), unitPrice: buyNow > 0 && fullRights ? money(packPriceToUnit(buyNow, packUnits)) : '' })
    : null
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

  // Code-barres saisi ou modifié : chiffres seuls = vrai code-barres attendu (chiffre de
  // contrôle faux → refusé ; longueur non standard, ex. « 50 » → confirmation « référence maison ? »).
  // Un code déjà enregistré et non modifié n'est jamais recontrôlé.
  const initialSku = (defaultValues?.sku || '').trim()
  const [confirmSku, setConfirmSku] = useState<ProductFormData | null>(null)

  // Envoi : une erreur de champ renvoyée par le serveur s'affiche sous le champ concerné
  // (la photo déjà choisie reste dans le formulaire : on corrige et on réenregistre)
  const pastExpiry = usePastExpiryConfirm()
  const submit = (data: ProductFormData) => runSubmit(data, false)
  const runSubmit = async (data: ProductFormData, skuConfirmed: boolean) => {
    const sku = (data.sku || '').trim()
    if (sku && sku !== initialSku) {
      const kind = classifyBarcode(sku)
      if (kind === 'gtin_invalid') {
        setMoreOpen(true)
        form.setError('sku', { type: 'barcode', message: t('product_form.barcode_invalid') })
        form.setFocus('sku')
        return
      }
      if (kind === 'numeric_nonstandard' && !skuConfirmed) { setConfirmSku(data); return }
    }
    // Stock initial avec une date déjà passée : on demande, on n'interdit pas
    if (!isEdit && Number(data.quantity) > 0 && !(await pastExpiry.confirm([data.expiry_date]))) return
    const r = await onSubmit(data)
    if (r && typeof r === 'object' && 'field' in r) {
      if (MORE_FIELDS.includes(r.field)) setMoreOpen(true)
      form.setError(r.field, { type: 'server', message: r.message })
      form.setFocus(r.field)
    }
  }

  return (
    <>
    <form id={PRODUCT_FORM_ID} onSubmit={form.handleSubmit(submit, errs => { if (MORE_FIELDS.some(f => f in errs)) setMoreOpen(true) })} className="space-y-4" noValidate>

      {/* Session counter */}
      {!!sessionCount && sessionCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-sm text-green-700 dark:text-green-400 font-medium">
            {t('product_form.session_added', { count: sessionCount })}
          </span>
        </div>
      )}

      {/* ── Informations principales ─────────────────────────────────── */}
      <DrawerSection title={t('products.section_main')}>
        <div className="space-y-1.5" data-tour="product-name">
          <Label htmlFor="product-name">{t('products.name')}<RequiredMark /></Label>
          <Input id="product-name" {...form.register('name')} placeholder={t('product_form.name_placeholder')} aria-invalid={!!errors.name} autoFocus={autoFocusName} />
          <FieldError message={errors.name?.message} />
        </div>

        <div className="grid grid-cols-2 gap-3" data-tour="product-prices">
          <div className="space-y-1.5">
            <Label>{fine ? t(`measures.price_per_${coarse}` as any) : t('products.selling_price')}<RequiredMark /></Label>
            <Controller control={form.control} name="selling_price" render={({ field }) => (
              <InputGroup suffix={currency}>
                {fine ? (
                  <NumericInput value={toCoarsePrice(field.value)} onChange={v => field.onChange(v / FINE_FACTOR)} onBlur={field.onBlur} placeholder="0" currency={currency} className="h-10" aria-invalid={!!errors.selling_price} data-testid="product-price-coarse" />
                ) : (
                  <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" currency={currency} className="h-10" aria-invalid={!!errors.selling_price} />
                )}
              </InputGroup>
            )} />
            <FieldError message={errors.selling_price?.message} />
          </div>
          {fullRights && (
            <div className="space-y-1.5">
              <Label>{inPacks ? t('packaging.price_per_pack', { pack: unitLabel(packUnit, 1) }) : fine ? t(`measures.buy_per_${coarse}` as any) : t('products.buying_price')}</Label>
              <Controller control={form.control} name="buying_price" render={({ field }) => (
                <InputGroup suffix={currency}>
                  {fine ? (
                    <NumericInput value={toCoarsePrice(field.value)} onChange={v => field.onChange(v / FINE_FACTOR)} onBlur={field.onBlur} placeholder="0" currency={currency} className="h-10" data-testid="product-buy-coarse" />
                  ) : (
                    <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" currency={currency} className="h-10" />
                  )}
                </InputGroup>
              )} />
              <FieldError message={errors.buying_price?.message} />
            </div>
          )}
        </div>

        {/* Unité d'abord : le suffixe du stock initial reprend le choix fait juste avant */}
        <div className="grid grid-cols-2 gap-3" data-tour="product-stock">
          <div className="space-y-1.5">
            <Label>{t('products.unit')}</Label>
            <Select value={unit} onValueChange={changeUnit}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map(u => <SelectItem key={u} value={u}>{unitLabel(u, 1)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>{t('product_form.initial_stock')}<RequiredMark /></Label>
              <Controller control={form.control} name="quantity" render={({ field }) => fine ? (
                // Grammes / millilitres : saisis au kilo / au litre, décimales permises (37,5 kg = 37 500 g)
                <InputGroup suffix={unitLabel(coarse, 2)}>
                  <DecimalInput value={(Number(field.value) || 0) / FINE_FACTOR} onChange={v => field.onChange(Math.round(v * FINE_FACTOR))} onBlur={field.onBlur} className="h-10" aria-invalid={!!errors.quantity} data-testid="product-qty-coarse" />
                </InputGroup>
              ) : (
                <InputGroup suffix={inPacks ? unitLabel(packUnit, Number(field.value) || 2) : unitLabel(unit, Number(field.value) || 2)}>
                  <NumericInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" currency={currency} className="h-10" aria-invalid={!!errors.quantity} />
                </InputGroup>
              )} />
              <FieldError message={errors.quantity?.message} />
            </div>
          )}
        </div>
        {/* Grammes / millilitres : le produit se vend par mesures (verre, boîte, seau…), réglées ici d'emblée */}
        {fine && measuresBlock}
        {/* Date de péremption du lot initial : seulement s'il y a du stock à dater */}
        {!isEdit && Number(form.watch('quantity')) > 0 && (
          <Controller control={form.control} name="expiry_date" render={({ field }) => (
            <ExpiryDateField id="product-expiry-date" value={field.value} onChange={v => field.onChange(v)} />
          )} />
        )}

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <ImagePlus className="h-3.5 w-3.5 text-muted-foreground" />
            {t('product_form.product_photo')} {optional}
          </Label>

          {imagePreview ? (
            <div className="flex items-start gap-3">
              <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border group shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt={t('product_form.photo_preview')} className="w-full h-full object-cover" />
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

      {/* ── Plus d'options (repliées) : catégorie, code-barres, seuil, fournisseur, emplacement ────────────────
          Simple devant (1er nov. 2026) : l'essentiel d'abord, avec la photo (utile en caisse) ; le reste s'ouvre seul
          quand il porte déjà une valeur (modification) ou quand le serveur y signale une erreur. */}
      <DrawerSection
        title={t('product_form.more_options')}
        description={t('product_form.more_options_hint')}
        collapsible
        open={moreOpen}
        onOpenChange={setMoreOpen}
      >
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
                className="inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Camera className="h-3.5 w-3.5" />
                {t('product_form.scan')}
              </button>
            )}
          >
            <Input id="product-sku" {...form.register('sku')} maxLength={SKU_MAX_LENGTH} placeholder={t('product_form.sku_placeholder')} className="font-mono text-sm" />
          </InputGroup>
          <p className="text-[11px] text-muted-foreground">{t('product_form.scanner_hint')}</p>
          <FieldError message={errors.sku?.message} />
          {showScanner && (
            <BarcodeScanner onDetected={handleBarcodeDetected} onClose={() => setShowScanner(false)} />
          )}
        </div>

        <div className="grid grid-cols-2 items-start gap-3">
          <div className="space-y-1.5">
            <Label>{t('product_form.threshold_label')}</Label>
            <Controller control={form.control} name="low_stock_threshold" render={({ field }) => (
              <NumericInput allowEmpty value={field.value ?? null} onChange={field.onChange} onBlur={field.onBlur}
                placeholder={t('product_form.threshold_placeholder', { count: shopLowStockThreshold || 10 })} className="h-10" data-testid="product-threshold" />
            )} />
            <p className="text-[11px] text-muted-foreground">{t('product_form.threshold_hint')}</p>
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

        {/* Emplacement dans la boutique (étape 10) : retrouver le produit, compter l'inventaire dans l'ordre du magasin */}
        <div className="space-y-1.5">
          <Label htmlFor="product-location">{t('product_form.location_label')} {optional}</Label>
          <Input id="product-location" {...form.register('location')} maxLength={60} placeholder={t('product_form.location_placeholder')} className="h-10" data-testid="product-location" />
          <FieldError message={errors.location?.message} />
        </div>

        {/* Vente en gros par paliers (202) : « dès 12 : 470 F · dès 24 : 450 F » ; en caisse, toute la ligne prend le
            meilleur palier atteint. Un palier d'abord, « + Ajouter un palier » jusqu'à 3 ; quantités proposées en un geste. */}
        {/* Vente à la mesure (203) pour les autres unités : pack de 6, carton, sac de 50 kg… */}
        {!fine && measuresBlock}
        {!fine && (
        <div className="space-y-2 rounded-lg border border-border p-3" data-testid="product-wholesale">
          <div>
            <p className="text-sm font-medium">{t('wholesale.title')} {optional}</p>
            <p className="text-xs text-muted-foreground">{t('wholesale.hint')}</p>
          </div>
          {tierRows.map((row, i) => (
            <div key={i} className="space-y-1" data-testid="product-tier">
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t('wholesale.min_label')}</Label>
                  <InputGroup suffix={unitLabel(unit, 2)}>
                    <NumericInput allowEmpty value={row.min_qty ?? null} onChange={v => setTier(i, { min_qty: v })} placeholder={i === 0 ? '12' : '24'} className="h-10" data-testid="product-tier-min" aria-label={t('wholesale.min_label')} />
                  </InputGroup>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('wholesale.price_label')}</Label>
                  <InputGroup suffix={currency}>
                    <NumericInput allowEmpty value={row.price ?? null} onChange={v => setTier(i, { price: v })} placeholder="0" className="h-10" data-testid="product-tier-price" aria-label={t('wholesale.price_label')} />
                  </InputGroup>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground" onClick={() => removeTier(i)} aria-label={t('wholesale.remove_tier')} disabled={tierRows.length === 1 && !row.min_qty && !row.price}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {tierExample(row) && <p className="text-xs text-emerald-700 dark:text-emerald-300" data-testid="product-wholesale-example">{tierExample(row)}</p>}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5" data-testid="product-tier-presets">
            {tierPresets(packUnits).map(pr => (
              <button key={pr.key} type="button" onClick={() => applyPreset(pr.qty)} className="h-8 rounded-full border border-input px-2.5 text-xs hover:bg-accent">
                {t(`wholesale.preset_${pr.key}` as any, { count: pr.qty, pack: unitLabel(packUnit || 'carton', 1) })}
              </button>
            ))}
            {tierRows.length < MAX_TIERS && (
              <button type="button" onClick={addTier} className="h-8 rounded-full px-2.5 text-xs font-medium text-stockshop-blue hover:bg-stockshop-blue-muted dark:text-blue-400 dark:hover:bg-blue-950/40" data-testid="product-tier-add">
                {t('wholesale.add_tier')}
              </button>
            )}
          </div>
          <FieldError message={(errors as any).price_tiers?.message} />
        </div>
        )}

        {/* Acheté en carton / paquet (création ; ensuite : fiche › Conditionnements) */}
        {!isEdit && !fine && (
          <div className="space-y-2 rounded-lg border border-border p-3" data-testid="product-pack">
            <div>
              <p className="text-sm font-medium">{t('wholesale.pack_title')} {optional}</p>
              <p className="text-xs text-muted-foreground">{t('wholesale.pack_hint')}</p>
            </div>
            <div className="grid grid-cols-2 items-start gap-3">
              <div className="space-y-1.5">
                <Label>{t('wholesale.pack_type')}</Label>
                <Select value={packUnit || NONE} onValueChange={v => form.setValue('pack_unit', v === NONE ? '' : v, { shouldDirty: true })}>
                  <SelectTrigger className="h-10" data-testid="product-pack-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('wholesale.pack_none')}</SelectItem>
                    {PACK_UNITS.map(u => <SelectItem key={u} value={u}>{unitLabel(u, 1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {packUnit && (
                <div className="space-y-1.5">
                  <Label htmlFor="product-pack-units">{t('packaging.units_placeholder', { base: unitLabel(unit, 2) })}</Label>
                  <Controller control={form.control} name="pack_units" render={({ field }) => (
                    <NumericInput allowEmpty id="product-pack-units" value={field.value ?? null} onChange={field.onChange} onBlur={field.onBlur} placeholder="24" className="h-10" data-testid="product-pack-units" />
                  )} />
                  <FieldError message={errors.pack_units?.message} />
                </div>
              )}
            </div>
            {packUnit && (
              <>
                <Input {...form.register('pack_barcode')} maxLength={32} placeholder={t('packaging.barcode_placeholder')} className="h-10 font-mono text-sm" data-testid="product-pack-barcode" />
                {packUnits && packUnits >= 2 ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!form.watch('initial_in_packs')} onChange={e => form.setValue('initial_in_packs', e.target.checked, { shouldDirty: true })} data-testid="product-initial-in-packs" />
                    <span>{t('wholesale.initial_in_packs', { pack: unitLabel(packUnit, 2) })}</span>
                  </label>
                ) : null}
                {packConversion && <p className="text-xs text-muted-foreground" data-testid="product-pack-conversion">{packConversion}</p>}
              </>
            )}
          </div>
        )}
      </DrawerSection>
    </form>
    {pastExpiry.dialog}

    {/* « 50 » n'est pas un code-barres standard : référence maison, ou erreur ? */}
    <ConfirmModal
      open={!!confirmSku}
      onOpenChange={o => { if (!o) { setConfirmSku(null); form.setFocus('sku') } }}
      category={t('products.sku')}
      title={t('product_form.barcode_nonstandard_title', { code: (confirmSku?.sku || '').trim() })}
      description={t('product_form.barcode_nonstandard_desc')}
      icon={<ScanLine className="h-4 w-4" />}
      tone="warning"
      confirmLabel={t('product_form.barcode_nonstandard_confirm')}
      cancelLabel={t('product_form.barcode_nonstandard_fix')}
      onConfirm={() => { const d = confirmSku; setConfirmSku(null); if (d) void runSubmit(d, true) }}
    />
    </>
  )
}
