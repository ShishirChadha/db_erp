import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Forgot password");

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto max-w-sm px-4 py-14 sm:px-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Forgot your password?</h1>
      <ForgotPasswordForm />
    </main>
  );
}
