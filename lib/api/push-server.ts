import webpush from 'web-push'

// VAPID keys can be unset in some environments (local dev, preview deploys
// without push configured) — calling web-push without them throws
// immediately, turning every push attempt into a 500 even for actions
// (a sale, an expense) that otherwise succeeded. Push is a best-effort
// notification layer, never something a caller should fail on — routes call
// this first and skip sending (not throw) when it returns false.
export function configureWebPush(): boolean {
  const { VAPID_MAILTO, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_MAILTO || !NEXT_PUBLIC_VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  webpush.setVapidDetails(VAPID_MAILTO, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  return true
}
