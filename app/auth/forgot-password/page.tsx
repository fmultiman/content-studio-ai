import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

export const metadata = { title: 'Esqueci minha senha' }

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return <ForgotPasswordForm invalidLink={error === 'invalid_link'} />
}
