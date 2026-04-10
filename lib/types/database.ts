export type UserRole = 'super_admin' | 'owner' | 'cashier' | 'stock_manager' | 'viewer'
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
  created_at: string
  // SaaS fields
  plan: string | null
  trial_ends_at: string | null
  plan_expires_at: string | null
  country: string | null
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
  created_at: string
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
