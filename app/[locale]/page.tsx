'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ShoppingCart, Package, Users, BarChart2, MessageCircle,
  CheckCircle2, ArrowRight, Star, Shield, Zap, CreditCard, Smartphone, Sun, Moon, Menu, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils/cn'
import { useTranslations } from 'next-intl'
import { COUNTRIES, type CountryCode } from '@/lib/saas/countries'
import { useTheme } from '@/lib/hooks/use-theme'

const LANGUAGES = [
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'ha', flag: '🇳🇬', label: 'Hausa' },
]

const FEATURE_ICONS = [ShoppingCart, Package, Users, BarChart2, MessageCircle, CreditCard]
const FEATURE_COLORS = [
  'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40',
  'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/40',
  'text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950/40',
  'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-950/40',
  'text-teal-600 bg-teal-50 dark:text-teal-400 dark:bg-teal-950/40',
  'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40',
]

export default function LandingPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('landing')
  const pathname = usePathname()
  const { isDark, toggle } = useTheme()
  const [pricingCountry, setPricingCountry] = useState<CountryCode>('NG')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const switchLanguage = (newLocale: string) => {
    const newPath = pathname.replace(`/${locale}`, `/${newLocale}`)
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000;SameSite=Lax`
    localStorage.setItem('NEXT_LOCALE', newLocale)
    window.location.href = newPath
  }

  const country = COUNTRIES[pricingCountry]

  const features = [
    { title: t('features.f1_title'), desc: t('features.f1_desc') },
    { title: t('features.f2_title'), desc: t('features.f2_desc') },
    { title: t('features.f3_title'), desc: t('features.f3_desc') },
    { title: t('features.f4_title'), desc: t('features.f4_desc') },
    { title: t('features.f5_title'), desc: t('features.f5_desc') },
    { title: t('features.f6_title'), desc: t('features.f6_desc') },
  ]

  const testimonials = [
    { name: t('testimonials.t1_name'), shop: t('testimonials.t1_shop'), text: t('testimonials.t1_text'), initials: 'MI' },
    { name: t('testimonials.t2_name'), shop: t('testimonials.t2_shop'), text: t('testimonials.t2_text'), initials: 'JM' },
    { name: t('testimonials.t3_name'), shop: t('testimonials.t3_shop'), text: t('testimonials.t3_text'), initials: 'UG' },
  ]

  const plans = [
    {
      name: 'Starter',
      price: country.prices.starter,
      popular: false,
      color: 'border-gray-200 dark:border-gray-700',
      features: [t('pricing.f1'), t('pricing.f2'), t('pricing.f3'), t('pricing.f4')],
    },
    {
      name: 'Pro',
      price: country.prices.pro,
      popular: true,
      color: 'border-stockshop-blue',
      features: [t('pricing.f5'), t('pricing.f6'), t('pricing.f7'), t('pricing.f8')],
    },
    {
      name: 'Business',
      price: country.prices.business,
      popular: false,
      color: 'border-gray-200 dark:border-gray-700',
      features: [t('pricing.f9'), t('pricing.f10'), t('pricing.f11'), t('pricing.f12')],
    },
  ]

  const formatPrice = (n: number) =>
    country.currency === 'NGN'
      ? `₦${n.toLocaleString('en-NG')}`
      : `${n.toLocaleString('fr-FR')} FCFA`

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-white">

      {/* ── NAVBAR ── */}
      <header className="sticky top-0 z-50 border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 h-14 md:h-20 flex items-center justify-between gap-2">

          {/* Logo */}
          <Link href={`/${locale}`} className="dark:bg-white dark:rounded-xl dark:px-2 overflow-hidden flex items-center flex-shrink-0">
            <img
              src="/logo-full.png"
              alt="StockShop"
              className="h-10 md:h-16 w-auto object-contain"
              style={{ mixBlendMode: 'multiply' }}
            />
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-500 dark:text-gray-400">
            <a href="#features" className="hover:text-gray-900 dark:hover:text-white transition-colors">{t('nav.features')}</a>
            <a href="#pricing" className="hover:text-gray-900 dark:hover:text-white transition-colors">{t('nav.pricing')}</a>
            <a href="#testimonials" className="hover:text-gray-900 dark:hover:text-white transition-colors">{t('nav.reviews')}</a>
          </nav>

          {/* Right controls */}
          <div className="flex items-center gap-1">
            {/* Dark / Light toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggle}
              className="h-8 w-8 p-0 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {/* Language switcher */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 gap-1">
                  <span>{LANGUAGES.find(l => l.code === locale)?.flag ?? '🌐'}</span>
                  <span className="hidden sm:inline text-sm font-medium">
                    {(LANGUAGES.find(l => l.code === locale)?.label ?? locale).split(' ')[0]}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {LANGUAGES.map(lang => (
                  <DropdownMenuItem
                    key={lang.code}
                    onClick={() => switchLanguage(lang.code)}
                    className={locale === lang.code ? 'font-semibold text-stockshop-blue' : ''}
                  >
                    <span className="mr-2">{lang.flag}</span>
                    {lang.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Login — hidden on very small screens */}
            <Link href={`/${locale}/login`} className="hidden sm:block">
              <Button variant="ghost" size="sm" className="h-8 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
                {t('nav.login')}
              </Button>
            </Link>

            {/* CTA */}
            <Link href={`/${locale}/register`}>
              <Button size="sm" className="h-8 bg-stockshop-blue hover:bg-stockshop-blue-light text-white text-xs sm:text-sm px-3">
                {t('nav.start_trial')}
              </Button>
            </Link>

            {/* Mobile hamburger */}
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden h-8 w-8 p-0 text-gray-700 dark:text-gray-300 ml-1"
              onClick={() => setMobileMenuOpen(v => !v)}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-4 flex flex-col gap-3">
            <a href="#features" onClick={() => setMobileMenuOpen(false)} className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white py-1">{t('nav.features')}</a>
            <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white py-1">{t('nav.pricing')}</a>
            <a href="#testimonials" onClick={() => setMobileMenuOpen(false)} className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white py-1">{t('nav.reviews')}</a>
            <Link href={`/${locale}/login`} onClick={() => setMobileMenuOpen(false)} className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white py-1">{t('nav.login')}</Link>
          </div>
        )}
      </header>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-stockshop-blue via-[#0d3a84] to-[#1a4f9e] py-14 md:py-28">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-20 left-10 h-64 w-64 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 right-10 h-96 w-96 rounded-full bg-stockshop-gold blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 text-center">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold text-white leading-tight mb-4 md:mb-6">
              {t('hero.title')}<br />
              <span className="text-stockshop-gold">{t('hero.title_highlight')}</span>
            </h1>

            <p className="text-base md:text-xl text-blue-100 max-w-2xl mx-auto mb-6 md:mb-8 px-2">
              {t('hero.subtitle')}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6 px-4 sm:px-0">
              <Link href={`/${locale}/register`} className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto bg-stockshop-gold hover:bg-stockshop-gold-light text-gray-900 font-bold h-12 px-8 text-base gap-2">
                  {t('hero.cta_primary')}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <a href="#features" className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto bg-white/15 border border-white/40 text-white hover:bg-white/25 h-12 px-8 text-base backdrop-blur-sm">
                  {t('hero.cta_secondary')}
                </Button>
              </a>
            </div>

            <p className="text-blue-200 text-sm">{t('hero.no_card')}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.6 }}
            className="mt-10 md:mt-16 grid grid-cols-3 gap-3 max-w-sm md:max-w-lg mx-auto"
          >
            {[
              { value: '500+', label: t('hero.stat_shops') },
              { value: '2B+', label: t('hero.stat_sales') },
              { value: '4.9★', label: t('hero.stat_rating') },
            ].map(stat => (
              <div key={stat.label} className="bg-white/10 rounded-xl p-3 md:p-4">
                <p className="text-xl md:text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-blue-200 mt-1 leading-tight">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── TRUST BAR ── */}
      <section className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 py-4">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider font-medium">
            {t('trust.label')}
          </p>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('trust.cities')}</p>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="py-12 md:py-20 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">{t('features.title')}</h2>
            <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto">{t('features.subtitle')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {features.map((f, i) => {
              const Icon = FEATURE_ICONS[i]
              return (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07 }}
                  className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className={cn('inline-flex h-10 w-10 md:h-11 md:w-11 items-center justify-center rounded-xl mb-3', FEATURE_COLORS[i])}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1.5">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section id="testimonials" className="bg-gray-50 dark:bg-gray-800/50 py-12 md:py-20 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-3">{t('testimonials.title')}</h2>
            <div className="flex justify-center gap-1 mb-2">
              {[...Array(5)].map((_, i) => <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />)}
            </div>
            <p className="text-muted-foreground text-sm md:text-base">{t('testimonials.rating')}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {testimonials.map((item, i) => (
              <motion.div
                key={item.name}
                initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-9 w-9 rounded-full bg-stockshop-blue flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {item.initials}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-900 dark:text-white">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.shop}</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed italic">"{item.text}"</p>
                <div className="flex gap-0.5 mt-3">
                  {[...Array(5)].map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />)}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="py-12 md:py-20 px-4">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-8 md:mb-10">
            <h2 className="text-2xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">{t('pricing.title')}</h2>
            <p className="text-base md:text-lg text-muted-foreground mb-5">{t('pricing.subtitle')}</p>

            {/* Country toggle */}
            <div className="inline-flex flex-wrap justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-1 gap-1">
              {Object.values(COUNTRIES).map(c => {
                const selected = pricingCountry === c.code
                return (
                  <button
                    key={c.code}
                    onClick={() => setPricingCountry(c.code)}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all"
                    style={selected
                      ? { backgroundColor: isDark ? '#1e293b' : '#fff', boxShadow: `0 0 0 2px ${c.flagColor}`, color: c.flagColor }
                      : { color: isDark ? '#9ca3af' : '#6b7280' }
                    }
                  >
                    <span className="text-base">{c.flag}</span>
                    <span className="hidden sm:inline">{c.name}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center justify-center gap-1">
              {country.gateway === 'paystack'
                ? <><CreditCard className="h-3.5 w-3.5" /> Paystack · Carte, Virement, USSD</>
                : <><Smartphone className="h-3.5 w-3.5" /> Flutterwave · MTN MoMo · Orange Money · Wave</>
              }
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {plans.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className={cn(
                  'relative rounded-2xl border-2 bg-white dark:bg-gray-800/50 p-6 shadow-sm',
                  plan.color,
                  plan.popular && 'shadow-xl ring-2 ring-stockshop-blue mt-4 md:mt-0'
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-stockshop-blue text-white px-3 py-1 text-xs font-semibold">
                      {t('pricing.popular')}
                    </Badge>
                  </div>
                )}

                <div className="mb-5">
                  <p className="font-bold text-gray-900 dark:text-white text-lg mb-1">{plan.name}</p>
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <span className="text-2xl md:text-3xl font-extrabold text-stockshop-blue dark:text-blue-400">
                      {formatPrice(plan.price)}
                    </span>
                    <span className="text-muted-foreground text-sm">{t('pricing.per_month')}</span>
                  </div>
                </div>

                <ul className="space-y-2 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link href={`/${locale}/register`}>
                  <Button className={cn(
                    'w-full',
                    plan.popular
                      ? 'bg-stockshop-blue hover:bg-stockshop-blue-light text-white'
                      : 'border border-blue-600 dark:border-blue-400 text-stockshop-blue dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 bg-transparent'
                  )}>
                    {t('pricing.cta')}
                  </Button>
                </Link>
              </motion.div>
            ))}
          </div>

          <p className="text-center text-sm text-muted-foreground mt-6">{t('pricing.note')}</p>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="bg-stockshop-blue py-12 md:py-16 px-4">
        <div className="mx-auto max-w-2xl text-center">
          <Zap className="h-8 w-8 md:h-10 md:w-10 text-stockshop-gold mx-auto mb-3" />
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">{t('cta.title')}</h2>
          <p className="text-blue-200 mb-6 md:mb-8 text-sm md:text-base">{t('cta.subtitle')}</p>
          <Link href={`/${locale}/register`}>
            <Button size="lg" className="bg-stockshop-gold hover:bg-stockshop-gold-light text-gray-900 font-bold h-12 px-8 md:px-10 text-base gap-2 w-full sm:w-auto">
              {t('cta.button')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <p className="text-blue-300 text-sm mt-4">{t('cta.note')}</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 md:py-10 px-4 bg-white dark:bg-gray-900">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href={`/${locale}`} className="dark:bg-white dark:rounded-xl dark:px-2 overflow-hidden flex items-center">
              <img
                src="/logo-full.png"
                alt="StockShop"
                className="h-12 md:h-14 w-auto object-contain"
                style={{ mixBlendMode: 'multiply' }}
              />
            </Link>
            <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6 text-sm text-muted-foreground">
              <a href="#pricing" className="hover:text-foreground">{t('nav.pricing')}</a>
              <Link href={`/${locale}/login`} className="hover:text-foreground">{t('nav.login')}</Link>
              <Link href={`/${locale}/register`} className="hover:text-foreground">{t('nav.start_trial')}</Link>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              <span>{t('footer.secure')}</span>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-5">
            {t('footer.rights', { year: new Date().getFullYear() })}
          </p>
        </div>
      </footer>
    </div>
  )
}
