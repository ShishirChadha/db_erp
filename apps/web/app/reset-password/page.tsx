import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Choose a new password");

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto max-w-sm px-4 py-14 sm:px-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Choose a new password</h1>
      <ResetPasswordForm />
    </main>
  );
}
