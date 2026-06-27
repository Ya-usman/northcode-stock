import { NextResponse } from 'next/server'

// Bump MIN_ANDROID_VERSION_CODE in Vercel env vars to force an update.
// Set to 0 (or omit) to disable forced updates.
export async function GET() {
  return NextResponse.json({
    min_version_code: parseInt(process.env.MIN_ANDROID_VERSION_CODE || '0', 10),
    store_url: 'https://play.google.com/store/apps/details?id=com.northcode.stockshop',
  })
}
