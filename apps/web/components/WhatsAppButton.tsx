import { WHATSAPP_NUMBER } from "@/lib/business-info";

const DEFAULT_MESSAGE = "Hi DigitalBluez, I have a question about a product.";

export function WhatsAppButton() {
  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(DEFAULT_MESSAGE)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with DigitalBluez on WhatsApp"
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 transition-transform hover:scale-105"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
        <path d="M12.01 2C6.48 2 2 6.48 2 12.01c0 1.98.58 3.83 1.58 5.39L2 22l4.75-1.53a9.96 9.96 0 005.26 1.53h.01c5.53 0 10.01-4.48 10.01-10.01C22 6.48 17.53 2 12.01 2zm0 18.15h-.01a8.13 8.13 0 01-4.15-1.14l-.3-.18-3.09.99 1-3.02-.19-.31a8.13 8.13 0 01-1.25-4.33c0-4.5 3.66-8.16 8.17-8.16 2.18 0 4.23.85 5.77 2.39a8.11 8.11 0 012.39 5.78c0 4.5-3.66 8.16-8.34 8.98zm4.48-6.12c-.25-.12-1.45-.72-1.68-.8-.22-.08-.39-.12-.55.12-.16.25-.63.8-.77.96-.14.16-.28.18-.53.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.48-1.39-1.73-.14-.25-.02-.38.11-.5.11-.11.25-.28.37-.42.12-.14.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.55c.12.16 1.73 2.64 4.2 3.7.59.25 1.05.4 1.41.52.59.19 1.13.16 1.55.1.47-.07 1.45-.59 1.66-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.47-.28z" />
      </svg>
    </a>
  );
}
