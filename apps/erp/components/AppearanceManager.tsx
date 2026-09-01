'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme, THEMES, type ThemeName } from '@/components/ThemeProvider'

const THEME_META: Record<ThemeName, { label: string; description: string; swatch: string[] }> = {
  slate: { label: 'Slate', description: 'The default look — blue accent, neutral grays.', swatch: ['oklch(1 0 0)', 'oklch(0.546 0.215 262.9)', 'oklch(0.97 0 0)'] },
  ocean: { label: 'Ocean', description: 'Cooler teal-blue accent, cool-tinted neutrals.', swatch: ['oklch(1 0 0)', 'oklch(0.55 0.14 210)', 'oklch(0.96 0.01 230)'] },
  forest: { label: 'Forest', description: 'Green accent, warm-neutral grays.', swatch: ['oklch(1 0 0)', 'oklch(0.52 0.14 150)', 'oklch(0.96 0.01 145)'] },
  amber: { label: 'Amber', description: 'Warm orange accent, warm-tinted neutrals.', swatch: ['oklch(1 0 0)', 'oklch(0.62 0.17 50)', 'oklch(0.97 0.01 60)'] },
  midnight: { label: 'Midnight', description: 'Dark background, blue accent.', swatch: ['oklch(0.145 0 0)', 'oklch(0.65 0.19 260)', 'oklch(0.269 0 0)'] },
}

export default function AppearanceManager() {
  const { theme, setTheme } = useTheme()

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Pick a color theme. Applies instantly and stays saved to your account across devices.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {THEMES.map(name => {
          const meta = THEME_META[name]
          const active = theme === name
          return (
            <button
              key={name}
              type="button"
              onClick={() => setTheme(name, { persist: true })}
              className={cn(
                'text-left rounded-xl border p-4 transition-all hover:border-primary/50',
                active ? 'border-primary ring-1 ring-primary' : 'border-border'
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex gap-1.5">
                  {meta.swatch.map((color, i) => (
                    <span key={i} className="h-6 w-6 rounded-full border border-border" style={{ backgroundColor: color }} />
                  ))}
                </div>
                {active && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground">{meta.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
