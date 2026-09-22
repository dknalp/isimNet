# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# İşimNet

Küçük ve orta ölçekli işletmeler için müşteri cari hesabı ve ürün stok yönetimi uygulaması. Detaylı proje dokümanı: `docs/proje-dokumani.md`

## Komutlar

```bash
npm run dev      # Geliştirme sunucusu (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
npm run test                              # Tüm testleri çalıştır (vitest)
npm run test:coverage                     # Kapsam raporu ile testler
npx vitest run src/__tests__/github.test.ts  # Tek test dosyası
```

## Teknoloji

- **Framework:** Next.js (App Router) + TypeScript
- **Stil:** Tailwind CSS v4
- **Host:** Vercel (serverless)
- **Auth:** NextAuth.js v5 (beta) — Google OAuth
- **Depolama:** localStorage (önbellek) + GitHub Contents API (kalıcı, kullanıcı başına `users/{userId}/` klasörü içinde ayrı JSON dosyaları)

## Dizin Yapısı

```
src/
  app/
    api/
      auth/[...nextauth]/  # NextAuth route handler
      sync/                # GitHub senkronizasyon (GET: oku, POST: yaz)
    dashboard/             # Ana ekran — modül kartları
    dashboard/musteriler/  # Müşteri listesi + [id] detay
    dashboard/urunler/     # Ürün listesi + [id] detay
    dashboard/raporlar/    # Raporlar ve istatistikler
    dashboard/senkronizasyon/  # Manuel sync / veri yönetimi
  components/
    musteriler/            # Müşteri bileşenleri (modaller, kartlar, feed)
      SaleReceiptPDF.tsx   # @react-pdf/renderer — SSR yok, dynamic import zorunlu
    urunler/               # Ürün bileşenleri (modaller, kartlar)
    ui/                    # Paylaşılan UI (CurrencyInput vb.)
    Header.tsx / MenuCard.tsx / SignInButton.tsx
  lib/
    github.ts              # GitHub Contents API yardımcıları (readGitHubFile, writeGitHubFile)
    auth.ts                # NextAuth yapılandırması (handlers, auth, signIn/Out)
    customers.ts           # Customer, Sale, Payment, Debt tipleri + buildActivityFeed
    products.ts            # Product tipleri
    format.ts              # formatCurrency (tr-TR, TRY)
    currencyInput.ts       # CurrencyInput bileşeni için yardımcılar
    seedData.ts            # Geliştirme için örnek veri
  context/
    DataContext.tsx        # Global state — useData() hook'u, tüm CRUD
  types/
    next-auth.d.ts         # Session tipini genişletir (accessToken)
  middleware.ts            # NextAuth oturum koruması (/dashboard altı)
docs/
  proje-dokumani.md        # Tam proje dokümanı
```

## Tasarım Kuralları

- Mobil-first, responsive (tablet ve telefon öncelikli)
- Kart tabanlı UI, yuvarlatılmış köşeler (`rounded-2xl`)
- Sağ alt köşede sayfa bağlamına göre değişen **FAB (+)** butonu
- Arama çubuğu: müşteri ve ürün listelerinde zorunlu
- Light / Dark mod desteği (sistem ayarına göre otomatik)
- Büyük dokunma alanları, tek elle kullanım

Modal ve liste bileşenleri `src/components/musteriler/` ve `src/components/urunler/` altında toplanmıştır. `src/app/dashboard/` altındaki sayfa dosyaları yalnızca layout ve bu bileşenlerin bağlamasını içerir; iş mantığı bileşenlerin içindedir.

## Modüller

| Modül | Sayfa | Açıklama |
|---|---|---|
| Müşteri Listesi | `/dashboard/musteriler` | Arama + borç özeti kartları |
| Müşteri Detay | `/dashboard/musteriler/[id]` | Ciro, tahsilat, alacak, hareket geçmişi |
| Yeni Satış | Detay sayfasından FAB | Ürün seç, miktar, fiyat, KDV (%0/%10/%20) |
| Tahsilat | Detay sayfasından | Tutar + açıklama, borca otomatik düşüm |
| Ürün Listesi | `/dashboard/urunler` | Arama + stok + fiyat kartları |
| Ürün Detay | `/dashboard/urunler/[id]` | Düzenle, sil, istatistik |
| Raporlar | `/dashboard/raporlar` | Toplam alacak, mal varlığı, bu ay satış |
| Senkronizasyon | `/dashboard/senkronizasyon` | Manuel Drive sync, veri geri yükleme, tüm veriyi sıfırlama |

## Veri Akışı

`DataContext` (`src/context/DataContext.tsx`) tüm state'i yönetir ve client component'lara `useData()` hook'u ile erişim sağlar. `useData()` kullanan her bileşen `"use client"` direktifine sahip olmalıdır. İki katmanlı önbellekleme:

1. **localStorage** — uygulama açıldığında anında yüklenir, her değişiklikte yazılır.
2. **GitHub** — oturum varsa mount'ta `GET /api/sync` ile GitHub'dan çeker (`customers.json`, `products.json`); GitHub verisi localStorage'ın üzerine yazılır (GitHub kazanır). Her 10 dakikada bir ve uygulama kapanışında `POST /api/sync` ile GitHub'a yazar. SHA önbelleği (`shaCache` ref) dosya güncellemelerinde kullanılır.

`GET /api/sync` — GitHub'dan tüm veriyi okur, `{ customers, products }` döner  
`POST /api/sync` — Body: `{ customers, products }`, GitHub'a yazar

`middleware.ts` `/dashboard` altını korur; oturumu olmayan kullanıcıyı `/` landing sayfasına yönlendirir.

`src/lib/github.ts` — GitHub Contents API'ye erişen düşük seviye yardımcılar (`readGitHubFile`, `writeGitHubFile`). Env değişkenleri (`GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `GITHUB_BRANCH`) üzerinden yapılandırılır. Her kullanıcının verileri `users/{session.userId}/` klasöründe tutulur; SHA önbelleği `DataContext` içindeki `shaCache` ref'inde saklanır.  
`src/lib/customers.ts` / `src/lib/products.ts` — tip tanımları ve `buildActivityFeed` gibi saf hesaplama fonksiyonları.

### ActivityItem ve hareket geçmişi

`Sale`, `Payment`, `Debt` ayrı tiplerdir. `buildActivityFeed(sales, payments, debts)` bunları tarihe göre sıralayıp `ActivityItem[]` döner; her öğenin `type: "sale" | "payment" | "debt"` ve birikimli bakiye (`runningBalance`) alanı vardır. Hareket geçmişi oluştururken doğrudan bu fonksiyonu kullan, elle filtreleme/sıralama yapma.

### Ortam Değişkenleri

```
GOOGLE_CLIENT_ID          # Google OAuth (auth için)
GOOGLE_CLIENT_SECRET
AUTH_SECRET
NEXTAUTH_URL
GITHUB_TOKEN              # PAT — contents: read+write izni gerekli
GITHUB_REPO_OWNER         # Repository sahibinin kullanıcı adı
GITHUB_REPO_NAME          # Veri repository adı
GITHUB_BRANCH             # Hedef branch (varsayılan: main)
```

## İş Kuralları

- KDV ürün bazında değil **satış bazında** (%0, %10, %20)
- Satış kaydedilince stok otomatik düşer
- Tahsilat borçtan otomatik düşer, ayrı kayıt tutulur
- Toplam Mal Varlığı = Σ (Fiyat × Stok)
- Güncel Alacak = Toplam Satış − Toplam Tahsilat