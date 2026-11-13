"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@db/shared"
import { Button } from "@db/ui/button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // grid-cols-1 (not bare `grid`) is load-bearing: it gives the implicit
          // single column an explicit `minmax(0, 1fr)` track. Without it, a child
          // with a long unbreakable string (a SKU code, a long customer/vendor
          // name) sizes the grid track to its own max-content width and blows
          // straight through max-w-lg/sm/etc -- the classic CSS Grid "blowout"
          // (https://css-tricks.com/preventing-a-grid-blowout/). Caught via an
          // actual rendered screenshot of EditSaleDialog, not by auditing
          // className strings -- this bug is invisible to a text-based audit.
          //
          // The mobile edge-gutter now lives on WIDTH (`w-[calc(100%-2rem)]`),
          // not max-width -- previously it was `w-full` + `max-w-[calc(100%-2rem)]`
          // with a `sm:max-w-sm` cap, which relied on that max-w surviving
          // tailwind-merge. It never did: every caller here passes its own
          // plain `max-w-*` override with no variant prefix, and tailwind-merge
          // only drops a conflicting utility when both sides share the same
          // variant -- so a caller's `max-w-2xl` could never actually beat a
          // hardcoded `sm:max-w-sm` (different variant groups, both survive;
          // at >=640px the `sm:` one won the cascade by source order
          // regardless of DOM class order), AND the base max-w providing the
          // mobile gutter got silently stripped by the caller's own override,
          // leaving dialogs edge-to-edge on a phone with no `sm:` override to
          // catch it. Every dialog's max-w override in this app was silently
          // losing to this exact default until caught by reading
          // getComputedStyle() on a live render, not by reading source.
          // Putting the gutter on `width` instead fixes both at once: width
          // and max-width are different utility groups, so a caller's own
          // max-w-* now cleanly replaces just the default max-w-md cap via
          // tailwind-merge, while the gutter-bearing width is untouched and
          // still shrinks the dialog on a narrow phone regardless of that cap.
          "fixed top-1/2 left-1/2 z-50 grid grid-cols-1 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
