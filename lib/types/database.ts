export type UserRole = 'super_admin' | 'owner' | 'manager' | 'shop_manager' | 'cashier' | 'stock_manager' | 'viewer'
export type PaymentMethod = 'cash' | 'transfer' | 'credit' | 'paystack'
export type PaymentStatus = 'paid' | 'pending' | 'partial'
export type SaleStatus = 'active' | 'cancelled'
export type StockMovementType = 'in' | 'out' | 'adjustment' | 'sale'

export interface Shop {
  id: string
  name: string
  owner_id: string | null
  city: string
  state: string
  whatsapp: string | null
  logo_url: string | null
  currency: string
  low_stock_threshold: number
  tax_rate: number
  notify_whatsapp_low_stock: boolean
  notify_whatsapp_daily: boolean
  notify_whatsapp_each_sale: boolean
  notify_email_low_stock: boolean
  notify_email_daily: boolean
  notify_push_new_sale: boolean
  notify_push_new_expense: boolean
  created_at: string
  // SaaS fields
  plan: string | null
  trial_ends_at: string | null
  plan_expires_at: string | null
  country: string | null
  billing_country: string | null
  role_permissions: Record<string, Record<string, boolean>> | null
  deleted_at: string | null
}

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  shop_id: string | null
  phone: string | null
  is_active: boolean
  last_seen: string | null
  created_at: string
  locale: string | null
  country: string | null
  plan_grace_ends_at: string | null
  last_seen_announcement_at: string | null
}

export interface Expense {
  id: string
  shop_id: string
  amount: number
  description: string
  date: string
  category: string
  payment_method: 'cash' | 'mobile_money' | 'bank_transfer'
  is_recurring: boolean
  recurrence: 'weekly' | 'monthly' | null
  recurrence_day: number | null
  next_due_at: string | null
  template_id: string | null
  receipt_url: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ExpenseBudget {
  id: string
  shop_id: string
  category: string
  amount: number
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  shop_id: string
  name: string
  name_hausa: string | null
  created_at: string
}

export interface Supplier {
  id: string
  shop_id: string
  name: string
  phone: string | null
  city: string | null
  email: string | null
  created_at: string
  deleted_at: string | null
}

export type PurchaseOrderStatus = 'draft' | 'sent' | 'received' | 'cancelled'

export interface PurchaseOrderItem {
  id: string
  purchase_order_id: string
  product_id: string | null
  product_name: string
  unit: string | null
  quantity_ordered: number
  quantity_received: number | null
  unit_price: number | null
  created_at: string
}

export interface PurchaseOrder {
  id: string
  shop_id: string
  supplier_id: string | null
  reference: string
  status: PurchaseOrderStatus
  notes: string | null
  created_by: string | null
  sent_at: string | null
  received_at: string | null
  created_at: string
  updated_at: string
  // Joined
  purchase_order_items?: PurchaseOrderItem[]
}

export interface Product {
  id: string
  shop_id: string
  name: string
  name_hausa: string | null
  sku: string | null
  category_id: string | null
  supplier_id: string | null
  buying_price: number
  selling_price: number
  quantity: number
  unit: string
  low_stock_threshold: number | null
  image_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  // Joined fields
  categories?: Category
  suppliers?: Supplier
}

export interface Customer {
  id: string
  shop_id: string
  name: string
  phone: string | null
  city: string | null
  total_debt: number
  created_at: string
  deleted_at: string | null
}

export interface Sale {
  id: string
  shop_id: string
  sale_number: string
  customer_id: string | null
  cashier_id: string | null
  subtotal: number
  discount: number
  tax: number
  total: number
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  amount_paid: number
  balance: number
  paystack_reference: string | null
  notes: string | null
  created_at: string
  // Idempotency key — same value reused across retries of the same checkout
  // attempt so a duplicate insert is rejected instead of creating a second sale.
  client_request_id?: string | null
  // Cancellation
  sale_status: SaleStatus
  cancelled_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  // Joined fields
  customers?: Customer | null
  sale_items?: SaleItem[]
  profiles?: Profile | null
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string | null
  product_name: string
  quantity: number
  unit_price: number
  subtotal: number
}

export interface Payment {
  id: string
  sale_id: string
  amount: number
  method: string
  reference: string | null
  received_by: string | null
  paid_at: string
  // Joined
  sales?: Sale
}

export interface StockMovement {
  id: string
  shop_id: string
  product_id: string | null
  type: StockMovementType
  quantity: number
  previous_qty: number | null
  new_qty: number | null
  reason: string | null
  notes: string | null
  performed_by: string | null
  created_at: string
  // Joined
  products?: Product | null
  profiles?: Profile | null
}

// Cart types for POS
export interface CartItem {
  product: Product
  quantity: number
  unit_price: number
  subtotal: number
}

// Dashboard metrics
export interface DashboardMetrics {
  todayRevenue: number
  todaySalesCount: number
  lowStockCount: number
  outstandingDebt: number
}

export interface RevenueDataPoint {
  date: string
  revenue: number
  sales: number
  repayments: number
}

export interface TopProduct {
  name: string
  quantity: number
  revenue: number
}

// Report types
export interface ReportData {
  dateRange: { from: string; to: string }
  totalRevenue: number
  totalProfit: number
  salesCount: number
  byPaymentMethod: Record<PaymentMethod, number>
  topProducts: TopProduct[]
  cashierPerformance: {
    name: string
    sales: number
    revenue: number
  }[]
  stockValuation: {
    buyingValue: number
    sellingValue: number
    potentialProfit: number
  }
}

export interface ShopMember {
  id: string
  shop_id: string
  user_id: string
  role: UserRole
  is_active: boolean
  can_delete_sales: boolean
  can_delete_products: boolean
  invited_by: string | null
  joined_at: string
  created_at: string
  shops?: Shop
  profiles?: Profile
}

// Database types (Supabase-generated shape)
export type Database = {
  public: {
    Tables: {
      shops: { Row: Shop; Insert: Omit<Shop, 'id' | 'created_at'>; Update: Partial<Shop> }
      profiles: { Row: Profile; Insert: Omit<Profile, 'created_at'>; Update: Partial<Profile> }
      categories: { Row: Category; Insert: Omit<Category, 'id' | 'created_at'>; Update: Partial<Category> }
      suppliers: { Row: Supplier; Insert: Omit<Supplier, 'id' | 'created_at'>; Update: Partial<Supplier> }
      products: { Row: Product; Insert: Omit<Product, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Product> }
      customers: { Row: Customer; Insert: Omit<Customer, 'id' | 'created_at'>; Update: Partial<Customer> }
      sales: { Row: Sale; Insert: Omit<Sale, 'id' | 'balance' | 'sale_number' | 'created_at'>; Update: Partial<Sale> }
      sale_items: { Row: SaleItem; Insert: Omit<SaleItem, 'id' | 'subtotal'>; Update: Partial<SaleItem> }
      payments: { Row: Payment; Insert: Omit<Payment, 'id' | 'paid_at'>; Update: Partial<Payment> }
      stock_movements: { Row: StockMovement; Insert: Omit<StockMovement, 'id' | 'created_at'>; Update: Partial<StockMovement> }
    }
  }
}
