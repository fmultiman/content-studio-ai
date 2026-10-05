import { redirect } from 'next/navigation'

// Temporary compatibility URL: generation resume now belongs to the
// canonical Session workspace and this path must not remain a second hub.
export default function ImageDraftsCompatibilityPage() {
  redirect('/imagens')
}
