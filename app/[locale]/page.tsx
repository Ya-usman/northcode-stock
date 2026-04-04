'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ShoppingCart, Package, Users, Wifi, BarChart2, MessageCircle,
  CheckCircle2, ArrowRight, Star, Shield, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PLANS, formatPrice } from '@/lib/saas/plans'
import { cn } from '@/lib/utils/cn'

const FEATURES = [
  {
    icon: ShoppingCart,
    title: 'Sales in seconds',
    desc: 'Scan barcode or search product name. Complete a sale in under 10 seconds.',
    color: 'text-blue-600 bg-blue-50',
  },
  {
    icon: Package,
    title: 'Real-time stock tracking',
    desc: 'Know exactly what you have in your shop at any moment. Get alerts before running out.',
    color: 'text-green-600 bg-green-50',
  },
  {
    icon: Users,
    title: 'Credit & debt (bashi) tracker',
    desc: 'Record credit sales, track balances, and collect payments from customers easily.',
    color: 'text-purple-600 bg-purple-50',
  },
  {
    icon: Wifi,
    title: 'Works without internet',
    desc: 'Full offline mode. Your shop keeps running even with no connection. Syncs automatically.',
    color: 'text-amber-600 bg-amber-50',
  },
  {
    icon: BarChart2,
    title: 'Reports & insights',
    desc: 'Daily revenue, top products, cashier performance. Know your business numbers.',
    color: 'text-rose-600 bg-rose-50',
  },
  {
    icon: MessageCircle,
    title: 'Hausa + English',
    desc: 'Full support for English and Hausa. Switch language anytime from any screen.',
    color: 'text-teal-600 bg-teal-50',
  },
]

const TESTIMONIALS = [
  {
    name: 'Alhaji Musa Ibrahim',
    shop: 'Musa General Store, Kano',
    text: 'Before NorthCode, I never knew how much I was making daily. Now I check my phone and I know everything.',
    initials: 'MI',
  },
  {
    name: 'Hajiya Aisha Bello',
    shop: 'Aisha Fashion, Kaduna',
    text: 'The credit tracking feature saved me from many arguments with customers. Everything is recorded.',
    initials: 'AB',
  },
  {
    name: 'Usman Garba',
    shop: 'Garba Electronics, Sokoto',
    text: 'My cashier uses it without any training. Very easy. The offline mode works perfectly.',
    initials: 'UG',
  },
]

const PLAN_CARDS = [
  {
    plan: PLANS.starter,
    popular: false,
    color: 'border-gray-200',
    features: ['Up to 200 products', '3 staff accounts', 'CSV & PDF export', '90 days history', 'Full reports'],
  },
  {
    plan: PLANS.pro,
    popular: true,
    color: 'border-northcode-blue',
    features: ['Unlimited products', '10 staff accounts', 'WhatsApp receipts', '1 year history', 'Priority support'],
  },
  {
    plan: PLANS.business,
    popular: false,
    color: 'border-gray-200',
    features: ['Unlimited everything', 'Unlimited staff', 'Dedicated support', 'Custom onboarding', 'API access'],
  },
]

export default function LandingPage({ params: { locale } }: { params: { locale: string } }) {
  return (
    <div className="min-h-screen bg-white">
      {/* ── NAVBAR ── */}
      <header className="sticky top-0 z-50 border-b bg-white/90 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-northcode-blue flex items-center justify-center text-white font-bold text-sm">
              NC
            </div>
            <span className="font-bold text-northcode-blue text-lg">NorthCode Stock</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <a href="#testimonials" className="hover:text-foreground transition-colors">Reviews</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href={`/${locale}/login`}>
              <Button variant="ghost" size="sm">Log In</Button>
            </Link>
            <Link href={`/${locale}/register`}>
              <Button size="sm" className="bg-northcode-blue hover:bg-northcode-blue-light">
                Start Free Trial
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-northcode-blue via-[#0d3a84] to-[#1a4f9e] py-20 md:py-28">
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 h-64 w-64 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 right-10 h-96 w-96 rounded-full bg-northcode-gold blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Badge className="mb-4 bg-white/20 text-white border-white/30 text-xs">
              Built for Northern Nigeria • Kano · Kaduna · Sokoto · Maiduguri
            </Badge>

            <h1 className="text-4xl md:text-6xl font-extrabold text-white leading-tight mb-6">
              Run your boutique<br />
              <span className="text-northcode-gold">smarter, not harder</span>
            </h1>

            <p className="text-lg md:text-xl text-blue-100 max-w-2xl mx-auto mb-8">
              The only inventory system designed for Northern Nigeria boutiques —
              track stock, record sales, manage credit, and know your numbers.
              In English and Hausa.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
              <Link href={`/${locale}/register`}>
                <Button size="lg" className="bg-northcode-gold hover:bg-northcode-gold-light text-gray-900 font-bold h-12 px-8 text-base gap-2">
                  Start Free 14-Day Trial
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <a href="#features">
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 h-12 px-8 text-base">
                  See Features
                </Button>
              </a>
            </div>

            <p className="text-blue-200 text-sm">
              No credit card required &bull; Cancel anytime &bull; Works on any phone
            </p>
          </motion.div>

          {/* Stats bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="mt-16 grid grid-cols-3 gap-4 max-w-lg mx-auto"
          >
            {[
              { value: '500+', label: 'Active Shops' },
              { value: '₦2B+', label: 'Sales Tracked' },
              { value: '4.9★', label: 'Rating' },
            ].map(stat => (
              <div key={stat.label} className="bg-white/10 rounded-xl p-4">
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-blue-200 mt-1">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── TRUST BAR ── */}
      <section className="border-b bg-gray-50 py-6">
        <div className="mx-auto max-w-4xl px-4">
          <p className="text-center text-xs text-muted-foreground mb-4 uppercase tracking-wider font-medium">
            Trusted by boutiques across Northern Nigeria
          </p>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm font-medium text-gray-500">
            {['Kano', 'Kaduna', 'Sokoto', 'Maiduguri', 'Zaria', 'Katsina', 'Gusau', 'Bauchi'].map(city => (
              <span key={city}>📍 {city}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="py-20 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Everything your shop needs
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Simple enough for any staff to use. Powerful enough to run a serious business.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => {
              const Icon = f.icon
              return (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.07 }}
                  className="rounded-xl border bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className={cn('inline-flex h-11 w-11 items-center justify-center rounded-xl mb-4', f.color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section id="testimonials" className="bg-gray-50 py-20 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">What shop owners say</h2>
            <div className="flex justify-center gap-1 mb-2">
              {[...Array(5)].map((_, i) => <Star key={i} className="h-5 w-5 fill-yellow-400 text-yellow-400" />)}
            </div>
            <p className="text-muted-foreground">4.9/5 from 200+ reviews</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-white rounded-xl border p-6 shadow-sm"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-full bg-northcode-blue flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {t.initials}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-900">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.shop}</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed italic">"{t.text}"</p>
                <div className="flex gap-0.5 mt-3">
                  {[...Array(5)].map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />)}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="py-20 px-4">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Simple, honest pricing</h2>
            <p className="text-lg text-muted-foreground">
              Start free for 14 days. No credit card required.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLAN_CARDS.map(({ plan, popular, color, features }) => (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className={cn(
                  'relative rounded-2xl border-2 bg-white p-6 shadow-sm',
                  color,
                  popular && 'shadow-xl ring-2 ring-northcode-blue'
                )}
              >
                {popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-northcode-blue text-white px-3 py-1 text-xs font-semibold">
                      Most Popular
                    </Badge>
                  </div>
                )}

                <div className="mb-6">
                  <p className="font-bold text-gray-900 text-lg mb-1">{plan.name}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-northcode-blue">
                      ₦{plan.price_monthly.toLocaleString('en-NG')}
                    </span>
                    <span className="text-muted-foreground text-sm">/month</span>
                  </div>
                </div>

                <ul className="space-y-2.5 mb-6">
                  {features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link href={`/${locale}/register`}>
                  <Button
                    className={cn(
                      'w-full',
                      popular
                        ? 'bg-northcode-blue hover:bg-northcode-blue-light text-white'
                        : 'border border-northcode-blue text-northcode-blue hover:bg-northcode-blue-muted bg-transparent'
                    )}
                  >
                    Start Free Trial
                  </Button>
                </Link>
              </motion.div>
            ))}
          </div>

          <p className="text-center text-sm text-muted-foreground mt-6">
            All plans include 14-day free trial with full access &bull; Cancel anytime &bull; No hidden fees
          </p>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="bg-northcode-blue py-16 px-4">
        <div className="mx-auto max-w-2xl text-center">
          <Zap className="h-10 w-10 text-northcode-gold mx-auto mb-4" />
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to know your business numbers?
          </h2>
          <p className="text-blue-200 mb-8">
            Join hundreds of Northern Nigeria boutiques already using NorthCode Stock.
          </p>
          <Link href={`/${locale}/register`}>
            <Button size="lg" className="bg-northcode-gold hover:bg-northcode-gold-light text-gray-900 font-bold h-12 px-10 text-base gap-2">
              Create Free Account
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <p className="text-blue-300 text-sm mt-4">No credit card &bull; Setup in 2 minutes</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t py-10 px-4 bg-white">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-northcode-blue flex items-center justify-center text-white font-bold text-xs">NC</div>
              <span className="font-semibold text-northcode-blue">NorthCode Stock</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="#pricing" className="hover:text-foreground">Pricing</a>
              <Link href={`/${locale}/login`} className="hover:text-foreground">Login</Link>
              <Link href={`/${locale}/register`} className="hover:text-foreground">Register</Link>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              <span>Secure &bull; Private &bull; Made in Nigeria</span>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-6">
            © {new Date().getFullYear()} NorthCode. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
