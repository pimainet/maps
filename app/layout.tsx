import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Be_Vietnam_Pro, Fraunces } from 'next/font/google'
import './globals.css'

// Be Vietnam Pro: chữ giao diện, thiết kế riêng cho tiếng Việt nên dấu luôn rõ.
const fontUi = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ui',
  display: 'swap',
})

// Fraunces: chữ serif mảnh cho lời chào, tiêu đề và các con số lớn.
const fontDisplay = Fraunces({
  subsets: ['vietnamese', 'latin', 'latin-ext'],
  axes: ['opsz'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Local Growth OS — Tăng khách từ Google Maps',
  description: 'Theo dõi hồ sơ Google, kế hoạch 30 ngày, việc cần làm và bài viết của doanh nghiệp bạn ở một nơi.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  colorScheme: 'dark',
  themeColor: '#0b0f1a',
  userScalable: true,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`bg-background ${fontUi.variable} ${fontDisplay.variable}`}>
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
